// Chart colors per theme (dataviz reference palette, slots 1–2, stepped for each surface).
export function chartTheme(dark: boolean) {
  return dark
    ? { series1: '#3987e5', series2: '#d95926', grid: '#27272a', axis: '#a1a1aa', tooltipBg: '#18181b', tooltipBorder: '#3f3f46', text: '#f4f4f5' }
    : { series1: '#2a78d6', series2: '#eb6834', grid: '#e4e4e7', axis: '#71717a', tooltipBg: '#ffffff', tooltipBorder: '#e4e4e7', text: '#18181b' };
}
