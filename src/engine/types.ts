export type OptionType = 'Call' | 'Put';

export interface OptionInfo {
  underlying: string;
  /** ISO date YYYY-MM-DD */
  expiry: string;
  type: OptionType;
  strike: number;
}

export interface Transaction {
  /** Unique, increasing in file/merge order. */
  id: number;
  /** Activity date, ISO YYYY-MM-DD */
  date: string;
  instrument: string;
  description: string;
  code: string;
  /** Always non-negative; direction comes from `code`. */
  quantity: number;
  price: number;
  /** Signed cash impact: positive = cash in, negative = cash out. Net of fees. */
  amount: number;
  option?: OptionInfo;
  /** True when the engine created this row (inferred assignment leg, opening balance). */
  synthetic?: boolean;
  /** Counts toward basis/premium but not toward cash (opening balances already include it). */
  noCash?: boolean;
  /** Stock leg of an option assignment/exercise (matched or inferred). */
  assignmentLeg?: boolean;
  /** Entered by hand in the app, not imported from a CSV. */
  manual?: boolean;
  /** Which file(s) the row came from, for merged imports. */
  source?: string;
}

/** A note shown in the import panel. `ticker` + `action` let the UI offer a fix. */
export interface ImportNote {
  text: string;
  ticker?: string;
  action?: 'opening-shares' | 'opening-option';
}

export interface ParseResult {
  transactions: Transaction[];
  warnings: ImportNote[];
}

// ---------- Engine options ----------

export interface OpeningPosition {
  ticker: string;
  shares: number;
  costPerShare: number;
}

export interface OpeningOption {
  ticker: string;
  type: OptionType;
  strike: number;
  /** ISO date */
  expiry: string;
  contracts: number;
  /** Total credit received when it was sold (positive). */
  premium: number;
}

/** What the account held just before the first row of the export. */
export interface OpeningBalances {
  /** ISO date; defaults to the day before the first transaction. */
  asOf: string | null;
  /** null = estimate it: the smallest starting cash that keeps the balance from going negative. */
  cash: number | null;
  positions: OpeningPosition[];
  options: OpeningOption[];
}

export interface BasisOptions {
  includeDividends: boolean;
  includeLongOptions: boolean;
  /** 'all' = every premium ever collected on the ticker; 'currentCycle' = only since the current wheel cycle began. */
  scope: 'all' | 'currentCycle';
  /**
   * true = only premium from contracts that are closed (expired, bought back, assigned) lowers the basis;
   * premium from still-open puts/calls is left out until they close. false = count it as soon as it's received.
   */
  realizedOnly: boolean;
}

export const DEFAULT_BASIS: BasisOptions = { includeDividends: false, includeLongOptions: false, scope: 'all', realizedOnly: true };

export const EMPTY_OPENING: OpeningBalances = { asOf: null, cash: null, positions: [], options: [] };

export interface EngineOptions {
  opening?: OpeningBalances;
  basis?: BasisOptions;
  /** "Today" for open-cycle day counts; defaults to the real date. */
  today?: string;
}

// ---------- Results ----------

export interface OpenOption {
  key: string;
  underlying: string;
  expiry: string;
  type: OptionType;
  strike: number;
  side: 'short' | 'long';
  contracts: number;
  /** Net cash for the open contracts: positive = premium received (short), negative = paid (long). */
  cash: number;
  opened: string;
}

export interface BasisPoint {
  date: string;
  shares: number;
  /** Broker-style average cost per share. */
  avgCost: number;
  /** Average cost minus the basis reduction (per the active BasisOptions), per share. */
  trueBasis: number;
}

/** One trade that can lower (or raise) a ticker's true cost basis. */
export interface BasisItem {
  date: string;
  kind: 'put' | 'call' | 'dividend' | 'longOption';
  code: string;
  description: string;
  /** Cash effect: premium received (+), buyback cost (−), dividend, or long-option P/L. */
  amount: number;
  /** Part of `amount` that belongs to contracts still open today (short options only). */
  openAmount: number;
  /** Wheel cycle number at the time, if any. */
  cycle: number | null;
  /** How much of `amount` lowers the basis under the active BasisOptions (0 = not counted). */
  counted: number;
  /** Account name, in the combined view. */
  source?: string;
}

/** One closed (or still open) short put / short call, for analytics. */
export interface ShortTrade {
  ticker: string;
  type: OptionType;
  strike: number;
  expiry: string;
  opened: string;
  closed: string;
  contracts: number;
  /** Credit received minus buyback cost, for these contracts. */
  netPremium: number;
  /** strike × 100 × contracts */
  collateral: number;
  days: number;
  /** netPremium / collateral × 365 / days */
  annualizedYield: number;
  outcome: 'expired' | 'closed' | 'assigned';
  win: boolean;
}

/** A long option position (never part of the wheel). */
export interface LongTrade {
  ticker: string;
  type: OptionType;
  strike: number;
  expiry: string;
  opened: string;
  closed: string | null;
  contracts: number;
  /** Premium paid (positive). */
  cost: number;
  /** Sale proceeds (0 if expired/exercised/open). */
  proceeds: number;
  /** Realized P/L; null while open or when exercised (premium moved into share cost). */
  pl: number | null;
  outcome: 'open' | 'closed' | 'expired' | 'exercised';
}

export interface ExerciseEvent {
  date: string;
  ticker: string;
  type: OptionType;
  strike: number;
  contracts: number;
  /** Premium originally paid; added to share cost (call) or subtracted from proceeds (put). */
  premiumPaid: number;
}

export interface WheelCycle {
  ticker: string;
  index: number;
  start: string;
  end: string | null;
  status: 'open' | 'closed';
  premium: number;
  stockPL: number;
  dividends: number;
  longOptionsPL: number;
  /** premium + stockPL + dividends (realized only). */
  totalReturn: number;
  /** Peak capital tied up: cost of shares held + collateral of open short puts. */
  capital: number;
  days: number;
  returnPct: number | null;
  annualizedPct: number | null;
  assignments: number;
  calledAway: number;
  /** Account name, in the combined view. */
  source?: string;
}

export interface TickerPosition {
  ticker: string;
  shares: number;
  /** Total cost of the shares currently held (average-cost method). */
  costRaw: number;
  avgCost: number;
  /** Net premium from short options (STO − BTC), all time. */
  wheelPremium: number;
  putPremium: number;
  callPremium: number;
  /** Amount subtracted from costRaw to get the true basis, per the active BasisOptions (= Σ basisItems.counted). */
  basisReduction: number;
  /** Every premium / dividend / long-option event on the ticker, with what counts toward the basis. */
  basisItems: BasisItem[];
  /** Premium received for short contracts that are still open. */
  openPremium: number;
  /** (costRaw − basisReduction) / shares; null when no shares held. */
  trueCostBasis: number | null;
  realizedStock: number;
  /** Realized P/L on long options (sold or expired). Exercised premium goes into share cost instead. */
  otherOptionsPL: number;
  dividends: number;
  openOptions: OpenOption[];
  history: BasisPoint[];
  transactions: Transaction[];
  cycles: WheelCycle[];
  exercises: ExerciseEvent[];
}

export interface Portfolio {
  tickers: TickerPosition[];
  /** Opening cash + every Amount in the file(s). */
  cash: number;
  /** Every Amount in the file(s), without opening cash. */
  fileCash: number;
  /** Starting cash used (entered or estimated). */
  openingCash: number;
  /** True when openingCash was estimated because the file's cash would otherwise go negative. */
  openingCashEstimated: boolean;
  /** ACH / rollover / conversion deposits, plus opening capital. */
  netDeposits: number;
  /** Opening cash + opening positions at cost. */
  openingCapital: number;
  interest: number;
  otherCash: number;
  totalPremium: number;
  premiumByMonth: { month: string; premium: number }[];
  openOptions: OpenOption[];
  shortTrades: ShortTrade[];
  longTrades: LongTrade[];
  cycles: WheelCycle[];
  exercises: ExerciseEvent[];
  warnings: ImportNote[];
  firstDate: string | null;
  lastDate: string | null;
  transactionCount: number;
  basis: BasisOptions;
}
