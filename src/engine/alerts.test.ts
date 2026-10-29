import { describe, expect, it } from 'vitest';
import { parseRobinhoodCsv } from '../parser/robinhood';
import { buildPortfolio } from './ledger';
import { buildAlerts } from './alerts';

const header = '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"';
const row = (r: string[]) => [r[0], r[0], r[0], ...r.slice(1)].map((c) => `"${c}"`).join(',');
const text = [
  header,
  // newest first
  row(['3/4/2024', 'XYZ', 'XYZ 3/22/2024 Call $45.00', 'STO', '1', '$1.00', '$100.00']),
  row(['3/1/2024', 'ABC', 'ABC 3/8/2024 Put $20.00', 'STO', '1', '$0.50', '$50.00']),
  row(['2/1/2024', 'XYZ', 'XYZ Corp', 'Buy', '100', '$50.00', '($5,000.00)']),
  row(['1/2/2024', '', 'ACH Deposit', 'ACH', '', '', '$5,500.00']),
].join('\n');

describe('buildAlerts', () => {
  const portfolio = buildPortfolio(parseRobinhoodCsv(text).transactions, { today: '2024-03-05' });
  const dte = (o: { expiry: string }) => Math.round((Date.parse(o.expiry) - Date.parse('2024-03-05')) / 86_400_000);
  const alerts = buildAlerts({
    portfolio,
    prices: { XYZ: 40, ABC: 19 },
    marks: { 'XYZ|2024-03-22|Call|45': 0.2 },
    dte,
    dropThreshold: 0.15,
  });
  const ids = alerts.map((a) => a.id);

  it('flags an in-the-money put close to expiry as critical', () => {
    expect(alerts.find((a) => a.id === 'itm-ABC|2024-03-08|Put|20')!.severity).toBe('critical');
    expect(alerts[0].severity).toBe('critical');
    expect(ids).toContain('exp-ABC|2024-03-08|Put|20');
  });

  it('warns about a covered call below true cost basis', () => {
    // True basis = (5000 − 100) / 100 = 49 > 45 strike.
    expect(alerts.find((a) => a.id.startsWith('ccbasis'))!.detail).toContain('$4.00/share');
  });

  it('suggests closing at 50%+ captured, and flags the drop vs basis', () => {
    expect(alerts.find((a) => a.id.startsWith('profit'))!.title).toBe('80% of max profit captured');
    expect(ids).toContain('drop-XYZ'); // 40 vs 49 = −18%
  });

  it('flags put collateral above cash', () => {
    // Cash = 5500 − 5000 + 50 + 100 = 650 < 2000 collateral.
    expect(alerts.find((a) => a.id === 'collateral')!.severity).toBe('critical');
  });
});
