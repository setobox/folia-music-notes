#!/usr/bin/env bash
# Publish the installable directory to an independent, fast-forward-only market history.
set -euo pipefail

tag=${1:?expected source release tag}
package_dir=${2:?expected extracted music-notes directory}
market_ref=refs/heads/market

fail() { echo "Market publication failed: $*" >&2; exit 1; }

package_version() {
    node -e 'const m = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
        if (m.id !== "music-notes" || typeof m.version !== "string" ||
            !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){2}$/.test(m.version)) throw Error("Invalid music-notes manifest");
        console.log(m.version);'
}

version=$(package_version < "$package_dir/mod.json")
[[ $tag == "v$version" ]] || fail "Package version $version does not match $tag"
market_tag="market-$tag"
tag_ref="refs/tags/$market_tag"
git fetch --no-tags origin "refs/tags/$tag"
source_sha=$(git rev-parse --verify 'FETCH_HEAD^{commit}')

report() {
    local sha=$1
    echo "Source $tag ($source_sha), market $market_tag ($sha), directory music-notes"
    if [[ -n ${GITHUB_OUTPUT:-} ]]; then
        printf 'market_tag=%s\nmarket_sha=%s\nsource_sha=%s\n' "$market_tag" "$sha" "$source_sha" >> "$GITHUB_OUTPUT"
    fi
    if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
        local repo="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-setobox/folia-music-notes}"
        printf '### Folium 市场提交\n\n- 源码仓库：%s\n- 版本：`%s`（完整 commit：`%s`）\n- 模组目录：`music-notes`\n- [检查模组目录](%s/tree/%s/music-notes) · [开发源码 %s](%s/tree/%s)\n' \
            "$repo" "$market_tag" "$sha" "$repo" "$sha" "$tag" "$repo" "$source_sha" >> "$GITHUB_STEP_SUMMARY"
    fi
}

# Build the tree from the package bytes without Git attributes, a checkout or the user's index.
tmp=$(mktemp -d)
export GIT_INDEX_FILE="$tmp/index"
trap 'rm -f -- "$GIT_INDEX_FILE" "$GIT_INDEX_FILE.lock"; rmdir -- "$tmp"' EXIT
git read-tree --empty
[[ -z $(find "$package_dir" ! -type d ! -type f -print -quit) ]] || fail 'Package contains a non-regular file'
find "$package_dir" -type f -printf '%P\0' |
    while IFS= read -r -d '' file; do
        oid=$(git hash-object -w --no-filters -- "$package_dir/$file")
        printf '100644 %s\tmusic-notes/%s\0' "$oid" "$file"
    done | git update-index -z --index-info
tree=$(git write-tree)

# Fetch an exact branch or tag even in a shallow checkout; only a missing ref yields an empty result.
remote_commit() {
    local ref=$1 status
    if git ls-remote --exit-code --refs origin "$ref" > /dev/null; then
        git fetch --no-tags origin "$ref" >&2 || return 1
        git rev-parse --verify 'FETCH_HEAD^{commit}'
    else
        status=$?
        [[ $status == 2 ]] || return "$status"
    fi
}

for attempt in 1 2 3 4 5; do
    existing=$(remote_commit "$tag_ref")
    if [[ -n $existing ]]; then
        [[ $(git rev-parse "$existing^{tree}") == "$tree" ]] || fail "$market_tag already exists with different files"
        report "$existing"; exit 0
    fi

    head=$(remote_commit "$market_ref")
    commit=''
    parent=()
    advance=true
    if [[ -n $head ]]; then
        [[ $(git ls-tree --name-only "$head") == 'music-notes' ]] || fail 'Existing market branch contains other files'
        current=$(git show "$head:music-notes/mod.json" | package_version)
        if [[ $version == "$current" ]]; then
            [[ $(git rev-parse "$head^{tree}") == "$tree" ]] || fail "$tag already exists on market with different files"
            commit=$head
        elif [[ $(printf '%s\n' "$current" "$version" | sort -V | tail -n 1) == "$current" ]]; then
            # Backfill the older tag without making its files the tip of the market branch.
            advance=false
            commit=$(git log --format='%H %T' "$head" | awk -v tree="$tree" '$2 == tree && !found { print $1; found = 1 }')
        else
            parent=(-p "$head")
        fi
    fi

    if [[ -z $commit ]]; then
        commit=$(git -c user.name='github-actions[bot]' \
            -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
            commit-tree "$tree" "${parent[@]}" -m "Publish music-notes $tag" -m "Source: $source_sha")
    fi
    refs=("$commit:$tag_ref")
    if [[ $advance == true ]]; then refs+=("$commit:$market_ref"); fi
    if git push --atomic origin "${refs[@]}"; then
        report "$commit"; exit 0
    fi
    echo "Market push failed on attempt $attempt; checking remote history again" >&2
done
fail 'Could not publish the market refs after five attempts'
