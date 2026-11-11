// Chart colours and shared chart styling. Keep in sync with the tokens in index.css.
export const PRIMARY = '#2563EB'
export const PRIMARY_SOFT = '#DBEAFE'
export const HIGHLIGHT = '#F59E0B'
export const SIGNAL = '#DC2626'
export const INK = '#0F172A'
export const INK_SOFT = '#64748B'
export const LINE = '#E2E8F0'

const FONT = 'Inter, system-ui, sans-serif'

export const TICK = { fontFamily: FONT, fontSize: 12, fill: INK_SOFT }
export const TOOLTIP_STYLE = {
  backgroundColor: '#FFFFFF',
  border: `1px solid ${LINE}`,
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
  fontFamily: FONT,
  fontSize: 12,
}
