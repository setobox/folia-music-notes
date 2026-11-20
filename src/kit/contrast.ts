// Theme contrast calculation adapted from Folia's colorMix.ts and themeColorMath.ts.
type Channels = { r: number; g: number; b: number };

/** Read the hex and rgb() theme accents accepted by Folia. */
const readColor = (color: string): Channels | null => {
    const normalized = color.trim();
    const hex = normalized.match(/^#([a-f\d]{3}|[a-f\d]{6})$/i)?.[1];
    if (hex) {
        const full = hex.length === 3 ? [...hex].map(digit => digit + digit).join('') : hex;
        return {
            r: parseInt(full.slice(0, 2), 16),
            g: parseInt(full.slice(2, 4), 16),
            b: parseInt(full.slice(4, 6), 16),
        };
    }
    const rgb = normalized.match(/^rgba?\(([^)]+)\)$/);
    if (!rgb) return null;
    const [r, g, b] = rgb[1].split(',').slice(0, 3).map(part => Number.parseFloat(part.trim()));
    return [r, g, b].every(Number.isFinite) ? { r, g, b } : null;
};

const linearChannel = (value: number) => {
    const channel = Math.max(0, Math.min(255, Math.round(value))) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
};

const getRelativeLuminance = (color: string) => {
    const rgb = readColor(color);
    if (!rgb) return 0;
    return 0.2126 * linearChannel(rgb.r) + 0.7152 * linearChannel(rgb.g) + 0.0722 * linearChannel(rgb.b);
};

export const getContrastRatio = (foreground: string, background: string) => {
    const a = getRelativeLuminance(foreground);
    const b = getRelativeLuminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
