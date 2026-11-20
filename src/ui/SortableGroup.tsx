import { useLayoutEffect, useRef, useState, type DragEvent, type ReactElement, type ReactNode, type Ref } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { kitTransition, useKitReducedMotion } from '../kit/motion';

// A note row or a tag chip keeps its own control semantics while its group handles insertion and motion.
export type MoveItem = (key: string, target: string, side: 'before' | 'after') => Promise<void>;
type Axis = 'horizontal' | 'vertical';
type Slot = { node: HTMLElement; side: 'before' | 'after' };
const ITEM = '[data-sort-key][draggable="true"]';

/** Align the final layout position inside the local scroller, even while a popover or row is transformed. */
export function revealSortItem(item: HTMLElement) {
    const panel = item.closest<HTMLElement>('.st-scroll');
    if (!panel) return;
    const layoutTop = (element: HTMLElement) => {
        let total = 0;
        for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) total += node.offsetTop;
        return total;
    };
    const top = layoutTop(item) - layoutTop(panel) - panel.clientTop;
    const bottom = top + item.offsetHeight;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight;
}

function SortableEntry({ ref, axis, order, children }: {
    ref?: Ref<HTMLDivElement>; axis: Axis; order: string; children: ReactElement;
}) {
    const present = useIsPresent();
    return <motion.div ref={ref} inert={!present} aria-hidden={present ? undefined : true}
        className={axis === 'vertical' ? 'min-w-0' : 'inline-flex min-w-0 max-w-full shrink-0'}
        layout="position" layoutDependency={order}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ ...kitTransition('fast', false), layout: kitTransition('move', false) }}>
        {children}
    </motion.div>;
}

/** A gap in a wrapped row belongs to the nearest chip on that row; blank space after it means after. */
function insertion(event: DragEvent<HTMLDivElement>, axis: Axis): Slot | null {
    const { currentTarget: group, clientX: x, clientY: y } = event;
    const hit = event.target instanceof Element ? event.target : null;
    let node = hit?.closest<HTMLElement>(ITEM) ?? null;
    if (hit?.closest('[inert]')) return null;
    if (!node) {
        if (hit?.closest('button, input, [data-sort-fixed]')) return null;
        let nearestRow = Infinity;
        let nearestColumn = Infinity;
        for (const item of group.querySelectorAll<HTMLElement>(ITEM)) {
            if (item.closest('[inert]')) continue;
            const rect = item.getBoundingClientRect();
            const row = Math.max(rect.top - y, y - rect.bottom, 0);
            const column = Math.max(rect.left - x, x - rect.right, 0);
            if (row < nearestRow || (row === nearestRow && column < nearestColumn)) {
                node = item;
                nearestRow = row;
                nearestColumn = column;
            }
        }
    }
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const before = axis === 'vertical' ? y < rect.top + rect.height / 2 : x < rect.left + rect.width / 2;
    return { node, side: before ? 'before' : 'after' };
}

export function SortableGroup({ axis, move, className, label, before, after, children }: {
    axis: Axis; move: MoveItem; className: string; label?: string; before?: ReactNode; after?: ReactNode;
    children: readonly ReactElement[];
}) {
    const reduced = useKitReducedMotion();
    const group = useRef<HTMLDivElement>(null);
    const source = useRef<HTMLElement | null>(null);
    const mark = useRef<Slot | null>(null);
    const returnFocus = useRef<HTMLElement | null>(null);
    const skipClickUntil = useRef(0);
    const fixedPress = useRef(false);
    const [shadow, setShadow] = useState<ShadowRoot>();
    const order = JSON.stringify(children.map(child => child.key));
    const showMark = (next: Slot | null) => {
        if (next?.node === mark.current?.node && next?.side === mark.current?.side) return;
        mark.current?.node.removeAttribute('data-insert');
        if (next) next.node.dataset.insert = next.side;
        mark.current = next;
    };
    const finish = () => {
        if (source.current) {
            source.current.removeAttribute('data-dragging');
            skipClickUntil.current = performance.now() + 350;
        }
        source.current = null;
        showMark(null);
    };
    useLayoutEffect(() => {
        const root = group.current?.getRootNode();
        if (root instanceof ShadowRoot) setShadow(root);
        window.addEventListener('blur', finish);
        return () => { window.removeEventListener('blur', finish); finish(); };
    }, []);
    useLayoutEffect(() => {
        if (source.current && (!source.current.matches(ITEM) || source.current.closest('[inert]') || !group.current?.contains(source.current))) finish();
        const node = returnFocus.current;
        if (!node || !group.current?.contains(node)) { returnFocus.current = null; return; }
        const root = node.getRootNode() as Document | ShadowRoot;
        let active = node.ownerDocument.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        if (!active || active === node.ownerDocument.body || (root instanceof ShadowRoot && active === root.host)) {
            node.focus({ preventScroll: true });
        }
        if (root.activeElement === node) revealSortItem(node);
        returnFocus.current = null;
    }, [order]);
    const destination = (event: DragEvent<HTMLDivElement>) => {
        if (!source.current?.matches(ITEM) || source.current.closest('[inert]') || !event.currentTarget.contains(source.current)) return null;
        const slot = insertion(event, axis);
        return slot && slot.node !== source.current ? slot : null;
    };
    return <div ref={group} role={label ? 'group' : undefined} aria-label={label} data-sort-axis={axis} className={className}
        onPointerDownCapture={event => {
            skipClickUntil.current = 0;
            returnFocus.current = null;
            fixedPress.current = event.target instanceof Element && !!event.target.closest('[data-sort-fixed]');
        }}
        onClickCapture={event => {
            if (performance.now() < skipClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
        }}
        onBlurCapture={event => {
            if (event.relatedTarget && event.target === returnFocus.current) returnFocus.current = null;
        }}
        onKeyDown={event => {
            if (event.key === 'Escape' && source.current) { event.preventDefault(); event.stopPropagation(); finish(); return; }
            skipClickUntil.current = 0;
        }}
        onDragStart={event => {
            const node = event.target instanceof Element ? event.target.closest<HTMLElement>(ITEM) : null;
            if (!node || fixedPress.current || node.closest('[inert]')) { event.preventDefault(); return; }
            source.current = node;
            node.dataset.dragging = '';
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-folia-music-notes-sort', node.dataset.sortKey!);
        }}
        onDragOver={event => {
            if (!source.current) return;
            const slot = destination(event);
            if (slot) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
            showMark(slot);
        }}
        onDragLeave={event => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) showMark(null);
        }}
        onDrop={event => {
            if (!source.current) return;
            event.preventDefault(); event.stopPropagation();
            const key = source.current.dataset.sortKey!;
            const slot = destination(event);
            const active = (event.currentTarget.getRootNode() as Document | ShadowRoot).activeElement;
            finish();
            if (slot) {
                if (active instanceof HTMLElement && event.currentTarget.contains(active)) returnFocus.current = active;
                void move(key, slot.node.dataset.sortKey!, slot.side);
            }
        }}
        onDragEnd={finish}>
        {before}
        {reduced ? children : <AnimatePresence initial={false} mode="popLayout" root={shadow}>
            {children.map(child => <SortableEntry key={child.key} axis={axis} order={order}>{child}</SortableEntry>)}
        </AnimatePresence>}
        {after}
    </div>;
}
