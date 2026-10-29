import {
  DEFAULT_BASIS,
  type BasisOptions,
  type BasisItem,
  type BasisPoint,
  type EngineOptions,
  type ExerciseEvent,
  type ImportNote,
  type LongTrade,
  type OpenOption,
  type OpeningBalances,
  type OptionInfo,
  type Portfolio,
  type ShortTrade,
  type TickerPosition,
  type Transaction,
  type WheelCycle,
} from './types';

const SHORT_OPEN = 'STO';
const SHORT_CLOSE = 'BTC';
const LONG_OPEN = 'BTO';
const LONG_CLOSE = 'STC';
const EXPIRED = 'OEXP';
const ASSIGNED = 'OASGN';
const EXERCISED = 'OEXCS';
const OPENING_CASH = 'OPENCASH';
const OPTION_CODES = new Set([SHORT_OPEN, SHORT_CLOSE, LONG_OPEN, LONG_CLOSE, EXPIRED, ASSIGNED, EXERCISED]);

const EPS = 1e-6;
/** Fractional leftovers below this after a sale/transfer are rounding (e.g. 0.0215 received, 0.021468 sold). */
const SHARE_DUST = 1e-3;

// CFRI = conversion from traditional IRA, DRFRO = direct rollover, ITRF = transfer between
// Robinhood accounts (cash rows; share rows are handled as share transfers).
const DEPOSIT_CODES = new Set(['ACH', 'RTP', 'DCF', 'WIRE', 'CFRI', 'DRFRO', 'ACATI', 'ACATO', 'ITRF']);
// Rows that move shares in or out without a trade (no cash).
const SHARE_TRANSFER_CODES = new Set(['ITRF', 'REC', 'ACATI', 'ACATO']);
// SLIP = stock lending income, MTCH = Robinhood IRA match.
const INTEREST_CODES = new Set(['INT', 'SLIP', 'MTCH']);
const DIVIDEND_CODES = new Set(['CDIV', 'MDIV', 'DIV']);
const SPLIT_CODES = new Set(['SPL', 'SPR']);
const KNOWN_OTHER_CASH = new Set(['GOLD', 'DTAX', 'DFEE', 'AFEE', 'FUTSWP', 'MISC', 'GDBP', 'MINT', 'T/A', 'JNLC', 'JNLS']);

export function contractKey(o: OptionInfo): string {
  return `${o.underlying}|${o.expiry}|${o.type}|${o.strike}`;
}

interface TickerState {
  ticker: string;
  shares: number;
  costRaw: number;
  wheelPremium: number;
  putPremium: number;
  callPremium: number;
  realizedStock: number;
  otherOptionsPL: number;
  dividends: number;
  history: BasisPoint[];
  transactions: Transaction[];
  shortOpen: Map<string, OpenOption>;
  longOpen: Map<string, OpenOption>;
  longTrades: Map<string, LongTrade>;
  cycle: WheelCycle | null;
  cycles: WheelCycle[];
  exercises: ExerciseEvent[];
  basisItems: BasisItem[];
  /** STO items per open contract key, so their open share shrinks as contracts close. */
  openBatches: Map<string, BasisItem[]>;
}

function newTicker(ticker: string): TickerState {
  return {
    ticker,
    shares: 0,
    costRaw: 0,
    wheelPremium: 0,
    putPremium: 0,
    callPremium: 0,
    realizedStock: 0,
    otherOptionsPL: 0,
    dividends: 0,
    history: [],
    transactions: [],
    shortOpen: new Map(),
    longOpen: new Map(),
    longTrades: new Map(),
    cycle: null,
    cycles: [],
    exercises: [],
    basisItems: [],
    openBatches: new Map(),
  };
}

/**
 * Robinhood usually emits a stock Buy/Sell row next to an OASGN/OEXCS row, but
 * not always. For each assignment/exercise, find its matching stock row; if
 * there isn't one, synthesize it so share counts and cash stay correct.
 */
export function reconcileAssignments(txs: Transaction[]): { transactions: Transaction[]; warnings: ImportNote[] } {
  const warnings: ImportNote[] = [];
  const used = new Set<number>();
  /** assignment row id → its stock leg (matched from the file, or inferred). */
  const legs = new Map<number, Transaction>();
  let nextId = Math.max(-1, ...txs.map((t) => t.id)) + 1;

  for (const t of txs) {
    if ((t.code !== ASSIGNED && t.code !== EXERCISED) || !t.option) continue;
    const o = t.option;
    // Short put assigned / long call exercised → we buy shares. Otherwise we sell.
    const stockCode = (t.code === ASSIGNED) === (o.type === 'Put') ? 'Buy' : 'Sell';
    const shares = Math.round((t.quantity || 1) * 100);
    const match = txs.find(
      (s) =>
        !used.has(s.id) &&
        s.code === stockCode &&
        !s.option &&
        s.instrument === o.underlying &&
        Math.abs(s.quantity - shares) < EPS &&
        Math.abs(s.price - o.strike) < 0.01 &&
        Math.abs(daysBetween(s.date, t.date)) <= 5,
    );
    if (match) {
      used.add(match.id);
      legs.set(t.id, { ...match, assignmentLeg: true });
      continue;
    }
    const gross = shares * o.strike;
    legs.set(t.id, {
      id: nextId++,
      date: t.date,
      instrument: o.underlying,
      description: `Inferred ${stockCode.toLowerCase()} from ${t.code === ASSIGNED ? 'assignment' : 'exercise'} of ${t.description}`,
      code: stockCode,
      quantity: shares,
      price: o.strike,
      amount: stockCode === 'Buy' ? -gross : gross,
      synthetic: true,
      assignmentLeg: true,
    });
    warnings.push({
      text: `${t.date} ${o.underlying}: no stock row found for ${t.code} of ${o.type} $${o.strike}; inferred ${stockCode} ${shares} @ $${o.strike}.`,
      ticker: o.underlying,
    });
  }

  if (!legs.size) return { transactions: txs, warnings };
  // Move each stock leg directly before its assignment row (Robinhood's usual order,
  // but not guaranteed) so a wheel cycle never looks closed between the two.
  const out = txs.flatMap((t) => {
    if (used.has(t.id)) return [];
    const leg = legs.get(t.id);
    return leg ? [leg, t] : [t];
  });
  return { transactions: out, warnings };
}

/**
 * Cash accounts and IRAs can't go below $0, so if the file's running balance does, the export
 * must have started with at least that much cash. Returns that minimum (0 if never negative).
 */
export function estimateOpeningCash(input: Transaction[]): number {
  return lowestBalance(reconcileAssignments(input).transactions);
}

/**
 * −(lowest end-of-day cash balance), or 0 if it never goes negative. Expects reconciled rows.
 * Checked per day, not per row, because the export's order of trades within a day isn't reliable.
 */
function lowestBalance(rows: Transaction[]): number {
  let running = 0;
  let low = 0;
  rows.forEach((t, i) => {
    if (!t.noCash) running += t.amount;
    if (i === rows.length - 1 || rows[i + 1].date !== t.date) low = Math.min(low, running);
  });
  return low < -0.005 ? Math.round(-low * 100) / 100 : 0;
}

/** Synthetic rows for what the account held before the export starts. */
export function openingTransactions(opening: OpeningBalances | undefined, firstDate: string | null, cash: number, estimated = false): Transaction[] {
  const asOf = opening?.asOf || (firstDate ? addDays(firstDate, -1) : todayIso());
  const out: Transaction[] = [];
  let id = -1;
  if (Math.abs(cash) > EPS) {
    const description = estimated ? 'Estimated opening cash (lowest balance in the export would otherwise be negative)' : 'Opening cash balance';
    out.push({ id: id--, date: asOf, instrument: '', description, code: OPENING_CASH, quantity: 0, price: 0, amount: cash, synthetic: true });
  }
  if (!opening) return out;
  for (const p of opening.positions) {
    if (!p.ticker || p.shares <= 0) continue;
    const ticker = p.ticker.trim().toUpperCase();
    out.push({
      id: id--,
      date: asOf,
      instrument: ticker,
      description: 'Opening position',
      code: 'Buy',
      quantity: p.shares,
      price: p.costPerShare,
      amount: -p.shares * p.costPerShare,
      synthetic: true,
      noCash: true,
    });
  }
  for (const o of opening.options) {
    if (!o.ticker || o.contracts <= 0) continue;
    const ticker = o.ticker.trim().toUpperCase();
    out.push({
      id: id--,
      date: asOf,
      instrument: ticker,
      description: `Opening ${ticker} ${o.expiry} ${o.type} $${o.strike}`,
      code: SHORT_OPEN,
      quantity: o.contracts,
      price: o.premium / o.contracts / 100,
      amount: o.premium,
      option: { underlying: ticker, expiry: o.expiry, type: o.type, strike: o.strike },
      synthetic: true,
      noCash: true,
    });
  }
  return out;
}

export function buildPortfolio(input: Transaction[], options: EngineOptions = {}): Portfolio {
  const basis = options.basis ?? DEFAULT_BASIS;
  const today = options.today ?? todayIso();
  // Reconcile first so inferred assignment legs count toward cash and the starting-cash estimate.
  const reconciled = reconcileAssignments(input);
  const fileCash = reconciled.transactions.reduce((s, t) => s + (t.noCash ? 0 : t.amount), 0);
  const enteredCash = options.opening?.cash ?? null;
  const openingCash = enteredCash ?? lowestBalance(reconciled.transactions);
  const openingCashEstimated = enteredCash == null && openingCash > 0;
  const opening = openingTransactions(options.opening, input[0]?.date ?? null, openingCash, openingCashEstimated);
  const transactions = [...opening, ...reconciled.transactions];
  const reconcileWarnings = reconciled.warnings;
  const warnings: ImportNote[] = [...reconcileWarnings];
  const unknownCodes = new Map<string, number>();
  const tickers = new Map<string, TickerState>();
  const premiumByMonth = new Map<string, number>();
  // Closes of positions opened before the export starts: { contracts, cash }.
  const orphanCloses = new Map<string, { contracts: number; cash: number }>();
  const orphanLongCloses = new Map<string, { contracts: number; cash: number }>();
  const addOrphan = (m: typeof orphanCloses, ticker: string, contracts: number, cash: number) => {
    const o = m.get(ticker) ?? { contracts: 0, cash: 0 };
    m.set(ticker, { contracts: o.contracts + contracts, cash: o.cash + cash });
  };
  const shortTrades: ShortTrade[] = [];
  const closedLongTrades: LongTrade[] = [];

  let cash = 0;
  let netDeposits = 0;
  let openingCapital = 0;
  let interest = 0;
  let otherCash = 0;

  const get = (ticker: string) => {
    let t = tickers.get(ticker);
    if (!t) {
      t = newTicker(ticker);
      tickers.set(ticker, t);
    }
    return t;
  };

  const startCycle = (t: TickerState, date: string) => {
    if (t.cycle) return;
    t.cycle = {
      ticker: t.ticker,
      index: t.cycles.length + 1,
      start: date,
      end: null,
      status: 'open',
      premium: 0,
      stockPL: 0,
      dividends: 0,
      longOptionsPL: 0,
      totalReturn: 0,
      capital: 0,
      days: 0,
      returnPct: null,
      annualizedPct: null,
      assignments: 0,
      calledAway: 0,
    };
  };

  const afterEvent = (t: TickerState, tx: Transaction) => {
    const date = tx.date;
    const c = t.cycle;
    if (c) {
      // Skip the stock leg of an assignment: the put it replaces is still open until the OASGN row.
      if (!tx.assignmentLeg) {
        let putCollateral = 0;
        for (const o of t.shortOpen.values()) if (o.type === 'Put') putCollateral += o.strike * 100 * o.contracts;
        c.capital = Math.max(c.capital, t.costRaw + putCollateral);
      }
      if (t.shares <= EPS && t.shortOpen.size === 0) {
        c.end = date;
        c.status = 'closed';
        finalizeCycle(c, today);
        t.cycles.push(c);
        t.cycle = null;
      }
    }
    if (t.shares > EPS) {
      const point: BasisPoint = {
        date,
        shares: t.shares,
        avgCost: t.costRaw / t.shares,
        trueBasis: (t.costRaw - runningReduction(t, basis)) / t.shares,
      };
      const last = t.history[t.history.length - 1];
      if (last && last.date === date) t.history[t.history.length - 1] = point;
      else t.history.push(point);
    } else {
      // Mark the position as closed so combined (multi-account) histories stop counting it.
      const last = t.history[t.history.length - 1];
      const zero: BasisPoint = { date, shares: 0, avgCost: 0, trueBasis: 0 };
      if (last && last.date === date) t.history[t.history.length - 1] = zero;
      else if (last && last.shares > EPS) t.history.push(zero);
    }
  };

  /** Closes `qty` long contracts in the trade log, splitting a partially-closed position. */
  const closeLong = (t: TickerState, key: string, qty: number, date: string, outcome: LongTrade['outcome'], proceeds: number, pl: number | null) => {
    const open = t.longTrades.get(key);
    if (!open) return;
    const closing = Math.min(qty, open.contracts);
    const share = open.contracts > 0 ? closing / open.contracts : 1;
    closedLongTrades.push({ ...open, contracts: closing, cost: open.cost * share, closed: date, proceeds, pl, outcome });
    open.cost -= open.cost * share;
    open.contracts -= closing;
    if (open.contracts <= EPS) t.longTrades.delete(key);
  };

  const addItem = (t: TickerState, tx: Transaction, kind: BasisItem['kind'], amount: number): BasisItem => {
    const item: BasisItem = {
      date: tx.date,
      kind,
      code: tx.code,
      description: tx.description.split('\n')[0],
      amount,
      openAmount: 0,
      cycle: t.cycle?.index ?? null,
      counted: 0,
    };
    t.basisItems.push(item);
    return item;
  };

  /** Closes `qty` short contracts and logs the trade. `closeAmount` is the buyback cash (0 for expiry/assignment). */
  const closeShort = (t: TickerState, o: OptionInfo, key: string, qty: number, closeAmount: number, date: string, outcome: ShortTrade['outcome']) => {
    const pos = t.shortOpen.get(key);
    if (!pos) return;
    const contracts = Math.min(qty, pos.contracts);
    // The premium of the sold contracts becomes realized in the same proportion reduceOpen releases it.
    const stillOpen = pos.contracts > 0 ? (pos.contracts - contracts) / pos.contracts : 0;
    for (const item of t.openBatches.get(key) ?? []) item.openAmount *= stillOpen;
    const net = reduceOpen(t.shortOpen, key, qty) + closeAmount;
    if (!t.shortOpen.has(key)) t.openBatches.delete(key);
    const collateral = o.strike * 100 * contracts;
    const days = Math.max(1, Math.round(daysBetween(date, pos.opened)));
    shortTrades.push({
      ticker: o.underlying,
      type: o.type,
      strike: o.strike,
      expiry: o.expiry,
      opened: pos.opened,
      closed: date,
      contracts,
      netPremium: net,
      collateral,
      days,
      annualizedYield: collateral > 0 ? (net / collateral) * (365 / days) : 0,
      outcome,
      win: net > 0,
    });
  };

  for (const tx of transactions) {
    if (!tx.noCash) cash += tx.amount;
    const o = tx.option;
    const code = tx.code;

    // ---- Options ----
    if (o && OPTION_CODES.has(code)) {
      const t = get(o.underlying);
      t.transactions.push(tx);
      const key = contractKey(o);
      const qty = tx.quantity || 1;

      if (code === SHORT_OPEN || code === SHORT_CLOSE) {
        // A buyback of contracts sold before the export starts has no matching credit in the
        // file, so only the part matching known open contracts counts as premium (cash still counts).
        let premium = tx.amount;
        let known = qty;
        if (code === SHORT_CLOSE) {
          known = Math.min(qty, t.shortOpen.get(key)?.contracts ?? 0);
          premium = tx.amount * (known / qty);
          if (qty - known > EPS) addOrphan(orphanCloses, o.underlying, qty - known, tx.amount - premium);
        }
        if (code === SHORT_OPEN && o.type === 'Put') startCycle(t, tx.date);
        t.wheelPremium += premium;
        if (o.type === 'Put') t.putPremium += premium;
        else t.callPremium += premium;
        if (t.cycle) t.cycle.premium += premium;
        if (!tx.noCash && Math.abs(premium) > EPS) {
          const month = tx.date.slice(0, 7);
          premiumByMonth.set(month, (premiumByMonth.get(month) ?? 0) + premium);
        }

        const kind = o.type === 'Put' ? 'put' : 'call';
        if (code === SHORT_OPEN) {
          const pos = t.shortOpen.get(key) ?? openOption(o, 'short', tx.date);
          pos.contracts += qty;
          pos.cash += tx.amount;
          t.shortOpen.set(key, pos);
          const item = addItem(t, tx, kind, tx.amount);
          item.openAmount = tx.amount;
          t.openBatches.set(key, [...(t.openBatches.get(key) ?? []), item]);
        } else if (known > EPS) {
          addItem(t, tx, kind, premium);
          closeShort(t, o, key, known, premium, tx.date, 'closed');
        }
      } else if (code === LONG_OPEN) {
        const pos = t.longOpen.get(key) ?? openOption(o, 'long', tx.date);
        pos.contracts += qty;
        pos.cash += tx.amount;
        t.longOpen.set(key, pos);
        const trade = t.longTrades.get(key) ?? {
          ticker: o.underlying,
          type: o.type,
          strike: o.strike,
          expiry: o.expiry,
          opened: tx.date,
          closed: null,
          contracts: 0,
          cost: 0,
          proceeds: 0,
          pl: null,
          outcome: 'open' as const,
        };
        trade.contracts += qty;
        trade.cost += -tx.amount;
        t.longTrades.set(key, trade);
      } else if (code === LONG_CLOSE) {
        // Selling contracts bought before the export starts: cost unknown, so no P/L is booked for them.
        const known = Math.min(qty, t.longOpen.get(key)?.contracts ?? 0);
        const proceeds = tx.amount * (known / qty);
        if (qty - known > EPS) addOrphan(orphanLongCloses, o.underlying, qty - known, tx.amount - proceeds);
        if (known > EPS) {
          const released = reduceOpen(t.longOpen, key, known);
          const pl = proceeds + released;
          t.otherOptionsPL += pl;
          if (t.cycle) t.cycle.longOptionsPL += pl;
          addItem(t, tx, 'longOption', pl);
          closeLong(t, key, known, tx.date, 'closed', proceeds, pl);
        }
      } else if (code === EXPIRED) {
        // Expiry closes whichever side is open. Short premium is already in wheelPremium.
        if (t.shortOpen.has(key)) closeShort(t, o, key, qty, 0, tx.date, 'expired');
        if (t.longOpen.has(key)) {
          const released = reduceOpen(t.longOpen, key, qty);
          t.otherOptionsPL += released;
          if (t.cycle) t.cycle.longOptionsPL += released;
          addItem(t, tx, 'longOption', released);
          closeLong(t, key, qty, tx.date, 'expired', 0, released);
        }
      } else if (code === ASSIGNED) {
        closeShort(t, o, key, qty, 0, tx.date, 'assigned');
        if (t.cycle) {
          if (o.type === 'Put') t.cycle.assignments += qty;
          else t.cycle.calledAway += qty;
        }
      } else if (code === EXERCISED) {
        // Premium paid for an exercised long option becomes part of the stock trade:
        // added to share cost for a call, subtracted from sale proceeds for a put.
        const premiumPaid = -reduceOpen(t.longOpen, key, qty);
        if (o.type === 'Call') {
          t.costRaw += premiumPaid;
        } else {
          t.realizedStock -= premiumPaid;
          if (t.cycle) t.cycle.stockPL -= premiumPaid;
        }
        t.exercises.push({ date: tx.date, ticker: o.underlying, type: o.type, strike: o.strike, contracts: qty, premiumPaid });
        closeLong(t, key, qty, tx.date, 'exercised', 0, null);
      }
      afterEvent(t, tx);
      continue;
    }

    // ---- Stock ----
    if ((code === 'Buy' || code === 'Sell') && tx.instrument) {
      const t = get(tx.instrument);
      t.transactions.push(tx);
      if (code === 'Buy') {
        startCycle(t, tx.date);
        const cost = tx.amount !== 0 ? -tx.amount : tx.quantity * tx.price;
        t.shares += tx.quantity;
        t.costRaw += cost;
        if (tx.noCash) {
          netDeposits += cost;
          openingCapital += cost;
        }
      } else {
        const sold = Math.min(tx.quantity, Math.max(t.shares, 0));
        const avg = t.shares > EPS ? t.costRaw / t.shares : 0;
        const proceeds = tx.amount !== 0 ? tx.amount : tx.quantity * tx.price;
        // Shares bought before the export started have unknown cost: only book P/L on the known part.
        const realized = proceeds * (sold / tx.quantity) - avg * sold;
        t.realizedStock += realized;
        if (t.cycle) t.cycle.stockPL += realized;
        t.costRaw -= avg * sold;
        t.shares -= sold;
        if (tx.quantity - sold > EPS) {
          warnings.push({
            text: `${tx.date} ${tx.instrument}: sold ${tx.quantity} shares but only ${sold} are on record. The rest were bought before the export starts, so their cost is unknown.`,
            ticker: tx.instrument,
            action: 'opening-shares',
          });
        }
        if (t.shares < SHARE_DUST) {
          t.shares = 0;
          t.costRaw = 0;
        }
      }
      afterEvent(t, tx);
      continue;
    }

    // Shares moved between accounts or received (e.g. a stock reward), with no cash.
    if (SHARE_TRANSFER_CODES.has(code) && tx.instrument && tx.quantity > 0 && !tx.amount) {
      const t = get(tx.instrument);
      t.transactions.push(tx);
      const qtyText = `${+tx.quantity.toFixed(6)} share${tx.quantity === 1 ? '' : 's'}`;
      // ITRF/ACATO rows don't say which way; if the account holds the shares, they're leaving.
      const outgoing = code === 'ACATO' || (code === 'ITRF' && t.shares >= tx.quantity - EPS);
      if (outgoing) {
        const cost = t.shares > EPS ? (t.costRaw / t.shares) * tx.quantity : 0;
        t.costRaw -= cost;
        t.shares -= tx.quantity;
        if (t.shares < SHARE_DUST) {
          t.shares = 0;
          t.costRaw = 0;
        }
        netDeposits -= cost;
        warnings.push({
          text: `${tx.date} ${tx.instrument}: ${qtyText} transferred out of this account (${code}) at their $${cost.toFixed(2)} cost, counted as a withdrawal.`,
          ticker: tx.instrument,
        });
      } else {
        startCycle(t, tx.date);
        t.shares += tx.quantity;
        warnings.push({
          text: `${tx.date} ${tx.instrument}: received ${qtyText} (${code}) with no cost in the file, so they're counted at $0. Add them under Opening balances if you know what they cost.`,
          ticker: tx.instrument,
        });
      }
      afterEvent(t, tx);
      continue;
    }

    if (SPLIT_CODES.has(code) && tx.instrument) {
      const t = get(tx.instrument);
      t.transactions.push(tx);
      t.shares += code === 'SPR' ? -tx.quantity : tx.quantity;
      if (t.shares < EPS) t.shares = 0;
      warnings.push({ text: `${tx.date} ${tx.instrument}: stock split row (${code} ${tx.quantity}) applied to share count — verify the result.`, ticker: tx.instrument });
      afterEvent(t, tx);
      continue;
    }

    // ---- Cash-only ----
    if (code === OPENING_CASH) {
      netDeposits += tx.amount;
      openingCapital += tx.amount;
      continue;
    }
    if (DIVIDEND_CODES.has(code)) {
      if (tx.instrument) {
        const t = get(tx.instrument);
        t.dividends += tx.amount;
        if (t.cycle) t.cycle.dividends += tx.amount;
        t.transactions.push(tx);
        addItem(t, tx, 'dividend', tx.amount);
      } else otherCash += tx.amount;
      continue;
    }
    if (DEPOSIT_CODES.has(code)) {
      netDeposits += tx.amount;
      continue;
    }
    if (INTEREST_CODES.has(code)) {
      interest += tx.amount;
      continue;
    }
    if (!KNOWN_OTHER_CASH.has(code)) {
      unknownCodes.set(code || '(blank)', (unknownCodes.get(code || '(blank)') ?? 0) + 1);
    }
    otherCash += tx.amount;
  }

  const usd = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  for (const [ticker, o] of orphanCloses) {
    warnings.push({
      text: `${ticker}: bought back ${o.contracts} contract(s) sold before this export starts. The ${usd(o.cash)} buyback is left out of premium because the original credit isn't in the file (it still counts in cash).`,
      ticker,
      action: 'opening-option',
    });
  }
  for (const [ticker, o] of orphanLongCloses) {
    warnings.push({
      text: `${ticker}: sold ${o.contracts} long contract(s) bought before this export starts. Their cost is unknown, so the ${usd(o.cash)} proceeds are left out of options P/L (they still count in cash).`,
      ticker,
    });
  }
  for (const [code, n] of unknownCodes) {
    warnings.push({ text: `Unrecognized transaction code "${code}" (${n} row${n > 1 ? 's' : ''}) — counted as other cash only.` });
  }

  const positions: TickerPosition[] = [...tickers.values()]
    .map((t) => {
      const cycles = [...t.cycles];
      if (t.cycle) {
        finalizeCycle(t.cycle, today);
        cycles.push(t.cycle);
      }
      countBasisItems(t, basis);
      const reduction = t.shares > EPS ? t.basisItems.reduce((s, i) => s + i.counted, 0) : 0;
      return {
        ticker: t.ticker,
        shares: t.shares,
        costRaw: t.costRaw,
        avgCost: t.shares > EPS ? t.costRaw / t.shares : 0,
        wheelPremium: t.wheelPremium,
        putPremium: t.putPremium,
        callPremium: t.callPremium,
        basisReduction: reduction,
        basisItems: t.basisItems,
        openPremium: [...t.shortOpen.values()].reduce((s, o) => s + o.cash, 0),
        trueCostBasis: t.shares > EPS ? (t.costRaw - reduction) / t.shares : null,
        realizedStock: t.realizedStock,
        otherOptionsPL: t.otherOptionsPL,
        dividends: t.dividends,
        openOptions: [...t.shortOpen.values(), ...t.longOpen.values()].sort((a, b) => a.expiry.localeCompare(b.expiry)),
        history: t.history,
        transactions: t.transactions,
        // A "cycle" with no short options or assignments is just a stock trade, not a wheel.
        cycles: cycles.filter((c) => Math.abs(c.premium) > EPS || c.assignments > 0 || c.calledAway > 0),
        exercises: t.exercises,
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const openOptions = positions.flatMap((p) => p.openOptions).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const openLongTrades = [...tickers.values()].flatMap((t) => [...t.longTrades.values()]);
  const realRows = transactions.filter((t) => !t.synthetic);

  return {
    tickers: positions,
    cash,
    fileCash,
    openingCash,
    openingCashEstimated,
    netDeposits,
    openingCapital,
    interest,
    otherCash,
    totalPremium: positions.reduce((s, p) => s + p.wheelPremium, 0),
    premiumByMonth: [...premiumByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, premium]) => ({ month, premium })),
    openOptions,
    shortTrades: shortTrades.sort((a, b) => b.closed.localeCompare(a.closed)),
    longTrades: [...openLongTrades, ...closedLongTrades.sort((a, b) => (b.closed ?? '').localeCompare(a.closed ?? ''))],
    cycles: positions.flatMap((p) => p.cycles).sort((a, b) => (a.status === b.status ? b.start.localeCompare(a.start) : a.status === 'open' ? -1 : 1)),
    exercises: positions.flatMap((p) => p.exercises),
    warnings,
    firstDate: realRows[0]?.date ?? null,
    lastDate: realRows[realRows.length - 1]?.date ?? null,
    transactionCount: input.length,
    basis,
  };
}

export interface AccountData {
  name: string;
  /** That account's (merged) transactions, oldest first. */
  transactions: Transaction[];
  opening?: OpeningBalances;
}

/**
 * One portfolio across several accounts. Each account is calculated on its own (its own
 * average cost, starting cash, cycles), then positions in the same ticker are added together,
 * so one account's trades never change another account's cost.
 */
export function buildCombinedPortfolio(accounts: AccountData[], options: Omit<EngineOptions, 'opening'> = {}): Portfolio {
  const basis = options.basis ?? DEFAULT_BASIS;
  const parts = accounts
    .filter((a) => a.transactions.length)
    .map((a) => {
      const p = buildPortfolio(
        a.transactions.map((t) => ({ ...t, source: a.name })),
        { ...options, opening: a.opening },
      );
      return { name: a.name, p };
    });

  const sum = (f: (p: Portfolio) => number) => parts.reduce((s, x) => s + f(x.p), 0);
  const tag = <T extends object>(name: string, list: T[]) => list.map((x) => ({ ...x, source: name }));

  const byTicker = new Map<string, { name: string; t: TickerPosition }[]>();
  for (const { name, p } of parts) for (const t of p.tickers) byTicker.set(t.ticker, [...(byTicker.get(t.ticker) ?? []), { name, t }]);

  const tickers: TickerPosition[] = [...byTicker.entries()]
    .map(([ticker, list]) => {
      const total = (f: (t: TickerPosition) => number) => list.reduce((s, x) => s + f(x.t), 0);
      const shares = total((t) => t.shares);
      const costRaw = total((t) => t.costRaw);
      const reduction = total((t) => t.basisReduction);
      const held = shares > EPS;
      return {
        ticker,
        shares,
        costRaw,
        avgCost: held ? costRaw / shares : 0,
        wheelPremium: total((t) => t.wheelPremium),
        putPremium: total((t) => t.putPremium),
        callPremium: total((t) => t.callPremium),
        basisReduction: held ? reduction : 0,
        basisItems: list.flatMap(({ name, t }) => tag(name, t.basisItems)).sort((a, b) => a.date.localeCompare(b.date)),
        openPremium: total((t) => t.openPremium),
        trueCostBasis: held ? (costRaw - reduction) / shares : null,
        realizedStock: total((t) => t.realizedStock),
        otherOptionsPL: total((t) => t.otherOptionsPL),
        dividends: total((t) => t.dividends),
        openOptions: list
          .flatMap(({ name, t }) => t.openOptions.map((o) => ({ ...o, key: `${name}:${o.key}` })))
          .sort((a, b) => a.expiry.localeCompare(b.expiry)),
        history: mergeHistories(list.map((x) => x.t.history)),
        transactions: list.flatMap((x) => x.t.transactions).sort((a, b) => a.date.localeCompare(b.date)),
        cycles: list.flatMap(({ name, t }) => tag(name, t.cycles)),
        exercises: list.flatMap((x) => x.t.exercises),
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const months = new Map<string, number>();
  for (const { p } of parts) for (const m of p.premiumByMonth) months.set(m.month, (months.get(m.month) ?? 0) + m.premium);
  const dates = parts.flatMap((x) => [x.p.firstDate, x.p.lastDate]).filter((d): d is string => !!d).sort();

  return {
    tickers,
    cash: sum((p) => p.cash),
    fileCash: sum((p) => p.fileCash),
    openingCash: sum((p) => p.openingCash),
    openingCashEstimated: parts.some((x) => x.p.openingCashEstimated),
    netDeposits: sum((p) => p.netDeposits),
    openingCapital: sum((p) => p.openingCapital),
    interest: sum((p) => p.interest),
    otherCash: sum((p) => p.otherCash),
    totalPremium: sum((p) => p.totalPremium),
    premiumByMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, premium]) => ({ month, premium })),
    openOptions: tickers.flatMap((t) => t.openOptions).sort((a, b) => a.expiry.localeCompare(b.expiry)),
    shortTrades: parts.flatMap(({ name, p }) => tag(name, p.shortTrades)).sort((a, b) => b.closed.localeCompare(a.closed)),
    longTrades: parts.flatMap(({ name, p }) => tag(name, p.longTrades)),
    cycles: tickers
      .flatMap((t) => t.cycles)
      .sort((a, b) => (a.status === b.status ? b.start.localeCompare(a.start) : a.status === 'open' ? -1 : 1)),
    exercises: tickers.flatMap((t) => t.exercises),
    warnings: parts.flatMap(({ name, p }) => p.warnings.map((w) => ({ ...w, text: `${name}: ${w.text}` }))),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    transactionCount: accounts.reduce((s, a) => s + a.transactions.length, 0),
    basis,
  };
}

/** Adds several accounts' basis-over-time series into one (share-weighted). */
function mergeHistories(series: BasisPoint[][]): BasisPoint[] {
  const dates = [...new Set(series.flat().map((p) => p.date))].sort();
  const idx = series.map(() => -1);
  const out: BasisPoint[] = [];
  for (const date of dates) {
    let shares = 0;
    let cost = 0;
    let trueCost = 0;
    series.forEach((s, i) => {
      while (idx[i] + 1 < s.length && s[idx[i] + 1].date <= date) idx[i]++;
      const p = s[idx[i]];
      // A series' last point stays in effect until its next point (or until shares hit 0, when it has none).
      if (p && p.shares > EPS) {
        shares += p.shares;
        cost += p.avgCost * p.shares;
        trueCost += p.trueBasis * p.shares;
      }
    });
    if (shares > EPS) out.push({ date, shares, avgCost: cost / shares, trueBasis: trueCost / shares });
  }
  return out;
}

/** Basis reduction at the current point of the replay (for the basis-over-time chart). */
function runningReduction(t: TickerState, basis: BasisOptions): number {
  const openPremium = basis.realizedOnly ? [...t.shortOpen.values()].reduce((s, o) => s + o.cash, 0) : 0;
  if (basis.scope === 'currentCycle') {
    const c = t.cycle;
    if (!c) return 0;
    return c.premium - openPremium + (basis.includeDividends ? c.dividends : 0) + (basis.includeLongOptions ? c.longOptionsPL : 0);
  }
  return t.wheelPremium - openPremium + (basis.includeDividends ? t.dividends : 0) + (basis.includeLongOptions ? t.otherOptionsPL : 0);
}

/** Sets each item's `counted` amount for the active options. Their sum is the basis reduction. */
function countBasisItems(t: TickerState, basis: BasisOptions) {
  const cycle = t.cycle?.index ?? null;
  for (const i of t.basisItems) {
    const kindOn = i.kind === 'dividend' ? basis.includeDividends : i.kind === 'longOption' ? basis.includeLongOptions : true;
    const inScope = basis.scope === 'all' || (cycle != null && i.cycle === cycle);
    i.counted = kindOn && inScope ? i.amount - (basis.realizedOnly ? i.openAmount : 0) : 0;
  }
}

function finalizeCycle(c: WheelCycle, today: string) {
  c.days = Math.max(1, Math.round(daysBetween(c.end ?? today, c.start)));
  c.totalReturn = c.premium + c.stockPL + c.dividends;
  c.returnPct = c.capital > EPS ? c.totalReturn / c.capital : null;
  c.annualizedPct = c.returnPct != null ? c.returnPct * (365 / c.days) : null;
}

function openOption(o: OptionInfo, side: 'short' | 'long', opened: string): OpenOption {
  return { key: contractKey(o), ...o, side, contracts: 0, cash: 0, opened };
}

/** Closes `qty` contracts and returns the proportional opening cash that was released. */
function reduceOpen(map: Map<string, OpenOption>, key: string, qty: number): number {
  const pos = map.get(key);
  if (!pos) return 0;
  const closing = Math.min(qty, pos.contracts);
  const released = pos.contracts > 0 ? (pos.cash * closing) / pos.contracts : 0;
  pos.contracts -= closing;
  pos.cash -= released;
  if (pos.contracts <= EPS) map.delete(key);
  return released;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(a) - Date.parse(b)) / 86_400_000;
}

function addDays(iso: string, n: number): string {
  const d = new Date(Date.parse(iso) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Days from `today` until an ISO expiry date. */
export function daysToExpiry(expiry: string, today = new Date()): number {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.parse(expiry) - t) / 86_400_000);
}
