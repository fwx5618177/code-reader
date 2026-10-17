// ================================
// 扩展数学符号支持模块
//
// 核心功能：
// 1. 扩展希腊字母支持
// 2. 更多数学运算符和符号
// 3. 物理和化学符号
// 4. 特殊函数和算子
// 5. 装饰符号和箭头扩展
// ================================

// ================================
// 扩展希腊字母
// ================================

/** 扩展希腊字母映射（包含变体） */
export const EXTENDED_GREEK_LETTERS: Record<string, string> = {
  // 小写希腊字母
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ϵ',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  varkappa: 'ϰ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'ϕ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  digamma: 'ϝ',

  // 大写希腊字母
  Alpha: 'Α',
  Beta: 'Β',
  Gamma: 'Γ',
  Delta: 'Δ',
  Epsilon: 'Ε',
  Zeta: 'Ζ',
  Eta: 'Η',
  Theta: 'Θ',
  Iota: 'Ι',
  Kappa: 'Κ',
  Lambda: 'Λ',
  Mu: 'Μ',
  Nu: 'Ν',
  Xi: 'Ξ',
  Omicron: 'Ο',
  Pi: 'Π',
  Rho: 'Ρ',
  Sigma: 'Σ',
  Tau: 'Τ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Chi: 'Χ',
  Psi: 'Ψ',
  Omega: 'Ω',

  // 变体大写
  varGamma: 'Γ',
  varDelta: 'Δ',
  varTheta: 'Θ',
  varLambda: 'Λ',
  varXi: 'Ξ',
  varPi: 'Π',
  varSigma: 'Σ',
  varUpsilon: 'Υ',
  varPhi: 'Φ',
  varPsi: 'Ψ',
  varOmega: 'Ω',
};

// ================================
// 扩展数学符号
// ================================

/** 扩展关系运算符 */
export const EXTENDED_RELATIONS: Record<string, string> = {
  // 基本关系
  eq: '=',
  ne: '≠',
  neq: '≠',
  lt: '<',
  gt: '>',
  le: '≤',
  leq: '≤',
  leqslant: '⩽',
  ge: '≥',
  geq: '≥',
  geqslant: '⩾',
  ll: '≪',
  gg: '≫',
  lll: '⋘',
  ggg: '⋙',

  // 相似和全等
  sim: '∼',
  simeq: '≃',
  cong: '≅',
  ncong: '≆',
  approx: '≈',
  approxeq: '≊',
  thickapprox: '≈',
  asymp: '≍',
  doteq: '≐',
  doteqdot: '≑',
  risingdotseq: '≓',
  fallingdotseq: '≒',
  circeq: '≗',
  eqcirc: '≖',
  triangleq: '≜',

  // 等价
  equiv: '≡',
  nequiv: '≢',
  Equiv: '≣',

  // 比例
  propto: '∝',
  varpropto: '∝',

  // 集合关系
  subset: '⊂',
  supset: '⊃',
  subseteq: '⊆',
  supseteq: '⊇',
  subseteqq: '⫅',
  supseteqq: '⫆',
  subsetneq: '⊊',
  supsetneq: '⊋',
  subsetneqq: '⫋',
  supsetneqq: '⫌',
  nsubseteq: '⊈',
  nsupseteq: '⊉',
  sqsubset: '⊏',
  sqsupset: '⊐',
  sqsubseteq: '⊑',
  sqsupseteq: '⊒',

  // 属于关系
  in: '∈',
  notin: '∉',
  ni: '∋',
  owns: '∋',
  notni: '∌',

  // 平行和垂直
  parallel: '∥',
  nparallel: '∦',
  perp: '⊥',
  bot: '⊥',

  // 其他关系
  mid: '∣',
  nmid: '∤',
  divides: '∣',
  shortmid: '∣',
  shortparallel: '∥',
  between: '≬',
  pitchfork: '⋔',
  backepsilon: '϶',
  smile: '⌣',
  frown: '⌢',
  bowtie: '⋈',
  Join: '⋈',
  ltimes: '⋉',
  rtimes: '⋊',

  // 三角关系
  triangleleft: '◁',
  triangleright: '▷',
  trianglelefteq: '⊴',
  trianglerighteq: '⊵',
  ntriangleleft: '⋪',
  ntriangleright: '⋫',
  ntrianglelefteq: '⋬',
  ntrianglerighteq: '⋭',

  // 偏序关系
  prec: '≺',
  succ: '≻',
  preceq: '⪯',
  succeq: '⪰',
  precneqq: '⪵',
  succneqq: '⪶',
  precnapprox: '⪹',
  succnapprox: '⪺',
  precsim: '≾',
  succsim: '≿',
  precnsim: '⋨',
  succnsim: '⋩',
  preccurlyeq: '≼',
  succcurlyeq: '≽',
  curlyeqprec: '⋞',
  curlyeqsucc: '⋟',

  // 否定关系
  nless: '≮',
  ngtr: '≯',
  nleq: '≰',
  ngeq: '≱',
  nleqslant: '≰',
  ngeqslant: '≱',
  lneq: '⪇',
  gneq: '⪈',
  lneqq: '≨',
  gneqq: '≩',
  lnsim: '⋦',
  gnsim: '⋧',
  lnapprox: '⪉',
  gnapprox: '⪊',
  nprec: '⊀',
  nsucc: '⊁',
  npreceq: '⋠',
  nsucceq: '⋡',
};

/** 扩展二元运算符 */
export const EXTENDED_BINARY_OPERATORS: Record<string, string> = {
  // 基本运算
  plus: '+',
  minus: '−',
  pm: '±',
  mp: '∓',
  times: '×',
  div: '÷',
  cdot: '⋅',
  centerdot: '⋅',
  ast: '∗',
  star: '⋆',
  circ: '∘',
  bullet: '•',
  divideontimes: '⋇',

  // 集合运算
  cap: '∩',
  cup: '∪',
  Cap: '⋒',
  Cup: '⋓',
  sqcap: '⊓',
  sqcup: '⊔',
  uplus: '⊎',
  setminus: '∖',
  smallsetminus: '∖',
  amalg: '⨿',

  // 逻辑运算
  land: '∧',
  lor: '∨',
  wedge: '∧',
  vee: '∨',
  barwedge: '⊼',
  veebar: '⊻',
  doublebarwedge: '⌆',
  curlywedge: '⋏',
  curlyvee: '⋎',

  // 圈运算符
  oplus: '⊕',
  ominus: '⊖',
  otimes: '⊗',
  oslash: '⊘',
  odot: '⊙',
  circledast: '⊛',
  circledcirc: '⊚',
  circleddash: '⊝',
  boxplus: '⊞',
  boxminus: '⊟',
  boxtimes: '⊠',
  boxdot: '⊡',

  // 其他二元运算符
  intercal: '⊺',
  dotplus: '∔',
  leftthreetimes: '⋋',
  rightthreetimes: '⋌',
  lhd: '⊲',
  rhd: '⊳',
  unlhd: '⊴',
  unrhd: '⊵',
  wr: '≀',
  dagger: '†',
  ddagger: '‡',

  // 除法变体
  slash: '/',
  backslash: '\\',
};

/** 扩展大型运算符 */
export const EXTENDED_LARGE_OPERATORS: Record<string, string> = {
  // 求和与乘积
  sum: '∑',
  prod: '∏',
  coprod: '∐',

  // 积分
  int: '∫',
  iint: '∬',
  iiint: '∭',
  iiiint: '⨌',
  oint: '∮',
  oiint: '∯',
  oiiint: '∰',
  intclockwise: '∱',
  ointclockwise: '∲',
  ointctrclockwise: '∳',
  varointclockwise: '∲',
  intbar: '⨍',
  intBar: '⨎',
  fint: '⨏',

  // 集合运算符
  bigcap: '⋂',
  bigcup: '⋃',
  bigsqcap: '⨅',
  bigsqcup: '⨆',
  biguplus: '⨄',

  // 逻辑运算符
  bigvee: '⋁',
  bigwedge: '⋀',

  // 其他大型运算符
  bigodot: '⨀',
  bigoplus: '⨁',
  bigotimes: '⨂',
  bigstar: '★',
};

// ================================
// 扩展箭头符号
// ================================

/** 扩展箭头符号 */
export const EXTENDED_ARROWS: Record<string, string> = {
  // 基本箭头
  leftarrow: '←',
  rightarrow: '→',
  uparrow: '↑',
  downarrow: '↓',
  leftrightarrow: '↔',
  updownarrow: '↕',
  to: '→',
  gets: '←',

  // 双线箭头
  Leftarrow: '⇐',
  Rightarrow: '⇒',
  Uparrow: '⇑',
  Downarrow: '⇓',
  Leftrightarrow: '⇔',
  Updownarrow: '⇕',
  implies: '⟹',
  impliedby: '⟸',
  iff: '⟺',

  // 长箭头
  longleftarrow: '⟵',
  longrightarrow: '⟶',
  longleftrightarrow: '⟷',
  Longleftarrow: '⟸',
  Longrightarrow: '⟹',
  Longleftrightarrow: '⟺',
  longmapsto: '⟼',

  // 映射箭头
  mapsto: '↦',
  longmapsfrom: '⟻',
  mapsfrom: '↤',
  hookrightarrow: '↪',
  hookleftarrow: '↩',

  // 斜箭头
  nearrow: '↗',
  nwarrow: '↖',
  searrow: '↘',
  swarrow: '↙',

  // 双头箭头
  twoheadleftarrow: '↞',
  twoheadrightarrow: '↠',
  leftleftarrows: '⇇',
  rightrightarrows: '⇉',
  upuparrows: '⇈',
  downdownarrows: '⇊',
  leftrightarrows: '⇆',
  rightleftarrows: '⇄',
  leftarrowtail: '↢',
  rightarrowtail: '↣',

  // 循环箭头
  looparrowleft: '↫',
  looparrowright: '↬',
  curvearrowleft: '↶',
  curvearrowright: '↷',
  circlearrowleft: '↺',
  circlearrowright: '↻',
  Lsh: '↰',
  Rsh: '↱',

  // 其他箭头
  leftrightharpoons: '⇋',
  rightleftharpoons: '⇌',
  leftharpoonup: '↼',
  leftharpoondown: '↽',
  rightharpoonup: '⇀',
  rightharpoondown: '⇁',
  upharpoonleft: '↿',
  upharpoonright: '↾',
  downharpoonleft: '⇃',
  downharpoonright: '⇂',

  // 否定箭头
  nleftarrow: '↚',
  nrightarrow: '↛',
  nLeftarrow: '⇍',
  nRightarrow: '⇏',
  nleftrightarrow: '↮',
  nLeftrightarrow: '⇎',

  // 带竖线的箭头
  leftarrowtriangle: '⇽',
  rightarrowtriangle: '⇾',
  leftrightarrowtriangle: '⇿',
  multimap: '⊸',

  // 波浪箭头
  leadsto: '⇝',
  rightsquigarrow: '⇝',
  leftrightsquigarrow: '↭',
};

// ================================
// 杂项符号
// ================================

/** 杂项数学符号 */
export const MISC_SYMBOLS: Record<string, string> = {
  // 无穷和极限
  infty: '∞',
  infinity: '∞',

  // 微积分
  partial: '∂',
  nabla: '∇',
  grad: '∇',

  // 逻辑符号
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  neg: '¬',
  lnot: '¬',
  therefore: '∴',
  because: '∵',

  // 集合符号
  emptyset: '∅',
  varnothing: '∅',
  nothing: '∅',
  complement: '∁',

  // 角度
  angle: '∠',
  measuredangle: '∡',
  sphericalangle: '∢',

  // 几何形状
  triangle: '△',
  bigtriangleup: '△',
  bigtriangledown: '▽',
  vartriangle: '△',
  triangledown: '▽',
  square: '□',
  blacksquare: '■',
  lozenge: '◊',
  blacklozenge: '⧫',
  diamond: '◇',
  Diamond: '◇',
  circle: '○',
  bigcirc: '○',
  bullet: '•',

  // 卡片符号
  clubsuit: '♣',
  diamondsuit: '♢',
  heartsuit: '♡',
  spadesuit: '♠',

  // 音乐符号
  flat: '♭',
  natural: '♮',
  sharp: '♯',

  // 其他
  dagger: '†',
  ddagger: '‡',
  S: '§',
  P: '¶',
  checkmark: '✓',
  maltese: '✠',
  circledR: '®',
  circledS: 'Ⓢ',

  // 省略号
  ldots: '…',
  cdots: '⋯',
  vdots: '⋮',
  ddots: '⋱',
  udots: '⋰',
  dots: '…',
  dotsb: '⋯',
  dotsc: '…',
  dotsm: '⋯',
  dotso: '…',
  dotsi: '⋯',

  // 素数和角度
  prime: '′',
  dprime: '″',
  trprime: '‴',
  backprime: '‵',
  degree: '°',

  // 特殊字母
  hbar: 'ℏ',
  hslash: 'ℏ',
  ell: 'ℓ',
  wp: '℘',
  Re: 'ℜ',
  Im: 'ℑ',
  aleph: 'ℵ',
  beth: 'ℶ',
  gimel: 'ℷ',
  daleth: 'ℸ',
  eth: 'ð',
  Finv: 'Ⅎ',
  Game: '⅁',
  mho: '℧',
  Bbbk: '𝕜',
};

// ================================
// 特殊函数
// ================================

/** 扩展函数名称 */
export const EXTENDED_FUNCTION_NAMES: Set<string> = new Set([
  // 三角函数
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch',
  'arcsin', 'arccos', 'arctan', 'arccot', 'arcsec', 'arccsc',
  'arcsinh', 'arccosh', 'arctanh', 'arccoth',
  'asin', 'acos', 'atan', 'acot',

  // 对数和指数
  'log', 'ln', 'lg', 'lb', 'exp',
  'Log',

  // 极限和边界
  'lim', 'limsup', 'liminf',
  'sup', 'inf', 'max', 'min',
  'Lim',

  // 代数函数
  'arg', 'deg', 'dim', 'gcd', 'lcm',
  'det', 'tr', 'rank', 'nul', 'span',
  'hom', 'ker', 'im', 'coker',

  // 概率和统计
  'Pr', 'E', 'Var', 'Cov', 'Corr',
  'prob', 'std',

  // 运算符
  'mod', 'bmod', 'pmod', 'pod',
  'sgn', 'sign', 'abs',
  'Re', 'Im',

  // 其他
  'id', 'Id',
  'dom', 'cod', 'ran',
  'supp', 'sgn',
  'proj', 'curl', 'div', 'grad', 'rot',
  'diag', 'erf', 'erfc',
  'sinc', 'rect', 'step',

  // 组合数学
  'ord', 'lcm', 'Res',
]);

// ================================
// 分隔符扩展
// ================================

/** 扩展分隔符 */
export const EXTENDED_DELIMITERS: Record<string, string> = {
  // 基本括号
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '\\{': '{',
  '\\}': '}',
  lbrace: '{',
  rbrace: '}',
  lbrack: '[',
  rbrack: ']',
  lparen: '(',
  rparen: ')',

  // 尖括号
  langle: '⟨',
  rangle: '⟩',
  lang: '⟨',
  rang: '⟩',
  lAngle: '⟪',
  rAngle: '⟫',

  // 地板和天花板
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',

  // 竖线和双竖线
  '|': '|',
  '\\|': '‖',
  vert: '|',
  Vert: '‖',
  lvert: '|',
  rvert: '|',
  lVert: '‖',
  rVert: '‖',

  // 其他括号
  lgroup: '⟮',
  rgroup: '⟯',
  lmoustache: '⎰',
  rmoustache: '⎱',
  ulcorner: '⌜',
  urcorner: '⌝',
  llcorner: '⌞',
  lrcorner: '⌟',

  // 空分隔符
  '.': '',
};

// ================================
// 重音符号扩展
// ================================

/** 扩展重音符号 */
export const EXTENDED_ACCENTS: Record<string, string> = {
  // 上方符号
  hat: '\u0302',
  widehat: '\u0302',
  check: '\u030C',
  widecheck: '\u030C',
  tilde: '\u0303',
  widetilde: '\u0303',
  acute: '\u0301',
  grave: '\u0300',
  dot: '\u0307',
  ddot: '\u0308',
  dddot: '\u20DB',
  ddddot: '\u20DC',
  breve: '\u0306',
  bar: '\u0304',
  overline: '\u0305',
  vec: '\u20D7',
  overleftarrow: '\u20D6',
  overrightarrow: '\u20D7',
  overleftrightarrow: '\u20E1',
  mathring: '\u030A',

  // 下方符号
  underline: '\u0332',
  underbar: '\u0332',
  utilde: '\u0330',
  underleftarrow: '←',
  underrightarrow: '→',
  underleftrightarrow: '↔',
};

// ================================
// 黑板粗体（集合符号）
// ================================

/** 黑板粗体映射 */
export const BLACKBOARD_BOLD: Record<string, string> = {
  A: '𝔸',
  B: '𝔹',
  C: 'ℂ',
  D: '𝔻',
  E: '𝔼',
  F: '𝔽',
  G: '𝔾',
  H: 'ℍ',
  I: '𝕀',
  J: '𝕁',
  K: '𝕂',
  L: '𝕃',
  M: '𝕄',
  N: 'ℕ',
  O: '𝕆',
  P: 'ℙ',
  Q: 'ℚ',
  R: 'ℝ',
  S: '𝕊',
  T: '𝕋',
  U: '𝕌',
  V: '𝕍',
  W: '𝕎',
  X: '𝕏',
  Y: '𝕐',
  Z: 'ℤ',
  k: '𝕜',
  '1': '𝟙',
  '0': '𝟘',
};

/** 手写体（花体）映射 */
export const CALLIGRAPHIC: Record<string, string> = {
  A: '𝒜',
  B: 'ℬ',
  C: '𝒞',
  D: '𝒟',
  E: 'ℰ',
  F: 'ℱ',
  G: '𝒢',
  H: 'ℋ',
  I: 'ℐ',
  J: '𝒥',
  K: '𝒦',
  L: 'ℒ',
  M: 'ℳ',
  N: '𝒩',
  O: '𝒪',
  P: '𝒫',
  Q: '𝒬',
  R: 'ℛ',
  S: '𝒮',
  T: '𝒯',
  U: '𝒰',
  V: '𝒱',
  W: '𝒲',
  X: '𝒳',
  Y: '𝒴',
  Z: '𝒵',
};

/** 哥特体（德文尖角体）映射 */
export const FRAKTUR: Record<string, string> = {
  A: '𝔄',
  B: '𝔅',
  C: 'ℭ',
  D: '𝔇',
  E: '𝔈',
  F: '𝔉',
  G: '𝔊',
  H: 'ℌ',
  I: 'ℑ',
  J: '𝔍',
  K: '𝔎',
  L: '𝔏',
  M: '𝔐',
  N: '𝔑',
  O: '𝔒',
  P: '𝔓',
  Q: '𝔔',
  R: 'ℜ',
  S: '𝔖',
  T: '𝔗',
  U: '𝔘',
  V: '𝔙',
  W: '𝔚',
  X: '𝔛',
  Y: '𝔜',
  Z: 'ℨ',
  a: '𝔞',
  b: '𝔟',
  c: '𝔠',
  d: '𝔡',
  e: '𝔢',
  f: '𝔣',
  g: '𝔤',
  h: '𝔥',
  i: '𝔦',
  j: '𝔧',
  k: '𝔨',
  l: '𝔩',
  m: '𝔪',
  n: '𝔫',
  o: '𝔬',
  p: '𝔭',
  q: '𝔮',
  r: '𝔯',
  s: '𝔰',
  t: '𝔱',
  u: '𝔲',
  v: '𝔳',
  w: '𝔴',
  x: '𝔵',
  y: '𝔶',
  z: '𝔷',
};

// ================================
// 组合数学符号
// ================================

/** 组合数学符号 */
export const COMBINATORIAL_SYMBOLS: Record<string, string> = {
  binom: '', // 特殊处理 (n choose k)
  choose: '', // 特殊处理
  tbinom: '', // 小号二项式
  dbinom: '', // 显示模式二项式
  genfrac: '', // 通用分式
  cfrac: '', // 连分数
  dfrac: '', // 显示模式分式
  tfrac: '', // 小号分式
  sfrac: '', // 斜分数
  xfrac: '', // 扩展分数
};

// ================================
// 物理符号
// ================================

/** 物理常数和符号 */
export const PHYSICS_SYMBOLS: Record<string, string> = {
  // 常用物理量
  hbar: 'ℏ',
  planck: 'ℎ',
  angstrom: 'Å',

  // 向量和张量
  vec: '', // 向量 (上箭头)
  bvec: '', // 粗体向量
  mat: '', // 矩阵
  tensor: '', // 张量

  // 微分运算
  dd: 'd', // 微分 d
  dv: '', // 导数
  pdv: '', // 偏导数
  fdv: '', // 泛函导数
  var: 'δ', // 变分

  // 括号
  bra: '⟨', // 左括号 <|
  ket: '⟩', // 右括号 |>
  braket: '', // 内积 <|>
  ketbra: '', // 外积 |><|

  // 单位
  si: '', // SI 单位
  SI: '', // SI 单位（带数值）
  num: '', // 数值
  unit: '', // 单位
};

// ================================
// 符号查找函数
// ================================

/** 仅检查自有属性，避免 \constructor 等命令命中原型链 */
export function hasOwn(table: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

/**
 * 查找符号
 * @param name 符号名称
 * @returns 对应的 Unicode 字符，如果未找到则返回 null
 */
export function lookupSymbol(name: string): string | null {
  // 按优先级查找各个符号表
  if (hasOwn(EXTENDED_GREEK_LETTERS, name)) {
    return EXTENDED_GREEK_LETTERS[name];
  }

  if (hasOwn(EXTENDED_RELATIONS, name)) {
    return EXTENDED_RELATIONS[name];
  }

  if (hasOwn(EXTENDED_BINARY_OPERATORS, name)) {
    return EXTENDED_BINARY_OPERATORS[name];
  }

  if (hasOwn(EXTENDED_LARGE_OPERATORS, name)) {
    return EXTENDED_LARGE_OPERATORS[name];
  }

  if (hasOwn(EXTENDED_ARROWS, name)) {
    return EXTENDED_ARROWS[name];
  }

  if (hasOwn(MISC_SYMBOLS, name)) {
    return MISC_SYMBOLS[name];
  }

  if (hasOwn(EXTENDED_DELIMITERS, name)) {
    return EXTENDED_DELIMITERS[name];
  }

  if (hasOwn(PHYSICS_SYMBOLS, name)) {
    return PHYSICS_SYMBOLS[name];
  }

  return null;
}

/**
 * 检查是否为已知符号
 * @param name 符号名称
 * @returns 是否为已知符号
 */
export function isKnownSymbol(name: string): boolean {
  return lookupSymbol(name) !== null || EXTENDED_FUNCTION_NAMES.has(name);
}

/**
 * 检查是否为函数名
 * @param name 函数名称
 * @returns 是否为函数名
 */
export function isFunctionName(name: string): boolean {
  return EXTENDED_FUNCTION_NAMES.has(name);
}

/**
 * 获取黑板粗体字符
 * @param char 原字符
 * @returns 黑板粗体字符
 */
export function getBlackboardBold(char: string): string {
  return BLACKBOARD_BOLD[char] || char;
}

/**
 * 获取花体字符
 * @param char 原字符
 * @returns 花体字符
 */
export function getCalligraphic(char: string): string {
  return CALLIGRAPHIC[char] || char;
}

/**
 * 获取哥特体字符
 * @param char 原字符
 * @returns 哥特体字符
 */
export function getFraktur(char: string): string {
  return FRAKTUR[char] || char;
}

/**
 * 获取重音符号
 * @param name 重音名称
 * @returns 重音符号
 */
export function getAccent(name: string): string | null {
  return EXTENDED_ACCENTS[name] || null;
}

/**
 * 获取分隔符
 * @param name 分隔符名称
 * @returns 分隔符字符
 */
export function getDelimiter(name: string): string | null {
  return hasOwn(EXTENDED_DELIMITERS, name) ? EXTENDED_DELIMITERS[name] : null;
}

// ================================
// 合并符号表（便于统一查找）
// ================================

/** 所有符号的合并映射 */
export const ALL_SYMBOLS: Record<string, string> = {
  ...EXTENDED_GREEK_LETTERS,
  ...EXTENDED_RELATIONS,
  ...EXTENDED_BINARY_OPERATORS,
  ...EXTENDED_LARGE_OPERATORS,
  ...EXTENDED_ARROWS,
  ...MISC_SYMBOLS,
  ...PHYSICS_SYMBOLS,
};

/** 大型运算符名称集合 */
export const LARGE_OPERATOR_NAMES: Set<string> = new Set(
  Object.keys(EXTENDED_LARGE_OPERATORS)
);

/** 关系运算符名称集合 */
export const RELATION_NAMES: Set<string> = new Set(
  Object.keys(EXTENDED_RELATIONS)
);

/** 二元运算符名称集合 */
export const BINARY_OPERATOR_NAMES: Set<string> = new Set(
  Object.keys(EXTENDED_BINARY_OPERATORS)
);

/** 箭头符号名称集合 */
export const ARROW_NAMES: Set<string> = new Set(
  Object.keys(EXTENDED_ARROWS)
);
