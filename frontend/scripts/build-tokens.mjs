// Writes src/styles/tokens.css from design-system/tokens.json, so the design system stays the one
// place these values are decided. Tailwind reads the @theme block, which is what makes classes
// like bg-surface, text-title and rounded-card exist. Runs before `npm run dev` and `npm run build`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const tokens = JSON.parse(readFileSync(path('design-system/tokens.json'), 'utf8'));

const themed = (theme) => (value) => (typeof value === 'object' ? value[theme] : value);
const light = themed('light');
const dark = themed('dark');

const lines = (entries, indent) => entries.map(([name, value]) => `${indent}--${name}: ${value};`).join('\n');

/** Token name to Tailwind theme variable. `radius` and `shadow` are the card's. */
const radiusName = (name) => (name === 'radius' ? 'radius-card' : name);
const shadowName = (name) => (name === 'shadow' ? 'shadow-card' : name);

const colors = tokens.color.tokens;
const shadows = tokens.shadow.tokens;
const layout = Object.fromEntries(tokens.layout.tokens.map((t) => [t.name, t.value]));
const collapse = Number.parseInt(layout.collapse, 10);

const theme = [
  ['color-*', 'initial'],
  ...colors.map((t) => [`color-${t.name}`, light(t.value)]),
  ['shadow-*', 'initial'],
  ...shadows.map((t) => [shadowName(t.name), light(t.value)]),
  ...tokens.radius.tokens.map((t) => [radiusName(t.name), t.value]),
  ['font-*', 'initial'],
  ['font-sans', tokens.type.families.sans],
  ['font-mono', tokens.type.families.mono],
  ['text-*', 'initial'],
  ...tokens.type.groups.flatMap((group) => group.styles).map((style) => [`text-${style.name}`, style.fontSize]),
  ['spacing-touch-target', layout['touch-target']],
  ['spacing-patient-target', layout['patient-target']],
  ['spacing-side-menu', layout['side-menu']],
  ['container-page', layout.container],
  // lg is where the side menu becomes a bottom bar. max-lg: means at or below `collapse`.
  ['breakpoint-*', 'initial'],
  ['breakpoint-sm', '621px'],
  ['breakpoint-md', '701px'],
  ['breakpoint-lg', `${collapse + 1}px`],
  ['breakpoint-xl', '1100px'],
  ['breakpoint-wide', '1280px'],
  ['breakpoint-2xl', '1620px'],
];

const darkEntries = [
  ...colors.map((t) => [`color-${t.name}`, dark(t.value)]),
  ...shadows.filter((t) => typeof t.value === 'object').map((t) => [shadowName(t.name), dark(t.value)]),
];

const css = `/* Generated from design-system/tokens.json by scripts/build-tokens.mjs. Edit the JSON, not this file. */
@theme static {
${lines(theme, '  ')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${lines(darkEntries, '    ')}
    color-scheme: dark;
  }
}

:root[data-theme='dark'] {
${lines(darkEntries, '  ')}
  color-scheme: dark;
}
`;

writeFileSync(path('src/styles/tokens.css'), css);
