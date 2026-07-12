/**
 * WGSL → GLSL ES 3.00 translation for generated node bodies (REQUIREMENTS.md
 * §13.12). Node codegen emits a constrained, backend-neutral subset of WGSL
 * (arithmetic, ctx helpers, scaffold variable reads); this module rewrites that
 * subset into GLSL so the webgl2 target reuses the exact same generated bodies
 * as the WGSU goldens. It is NOT a general WGSL translator — it handles only
 * constructs the codegen registry and orchestrator can produce.
 */

/** WGSL / slot types → GLSL declaration types. */
const TYPE_GLSL: Record<string, string> = {
  f32: 'float',
  u32: 'uint',
  i32: 'int',
  bool: 'bool',
  vec2: 'vec2',
  vec4: 'vec4',
  color: 'vec4',
  vec2f: 'vec2',
  vec3f: 'vec3',
  vec4f: 'vec4',
};

/** Index of the closing paren matching the opening paren at `open`. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced parens in generated code: ${s}`);
}

/** Split a call's argument list on top-level commas. */
function splitArgs(s: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      args.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(s.slice(start).trim());
  return args;
}

/** `select(f, t, cond)` → `((cond) ? (t) : (f))`, innermost-first. */
function rewriteSelect(src: string): string {
  let s = src;
  for (;;) {
    const m = /\bselect\(/.exec(s);
    if (m === null) return s;
    const open = m.index + m[0].length - 1;
    const close = matchParen(s, open);
    const args = splitArgs(s.slice(open + 1, close));
    if (args.length !== 3) throw new Error(`select() expects 3 args: ${s.slice(m.index, close + 1)}`);
    const [f, t, cond] = args as [string, string, string];
    s = s.slice(0, m.index) + `((${cond}) ? (${t}) : (${f}))` + s.slice(close + 1);
  }
}

const VEC_CMP: Record<string, string> = {
  '<': 'lessThan',
  '>': 'greaterThan',
  '<=': 'lessThanEqual',
  '>=': 'greaterThanEqual',
};

/** `any(a < b)` → `any(lessThan(a, b))` (WGSL vector compares → GLSL builtins). */
function rewriteVecCompare(src: string): string {
  let s = src;
  let from = 0;
  for (;;) {
    const m = /\bany\(/.exec(s.slice(from));
    if (m === null) return s;
    const at = from + m.index;
    const open = at + m[0].length - 1;
    const close = matchParen(s, open);
    const inner = s.slice(open + 1, close);
    // find a top-level comparison inside any(...)
    let depth = 0;
    let rewritten: string | undefined;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (depth === 0 && (c === '<' || c === '>')) {
        const op = inner[i + 1] === '=' ? c + '=' : c;
        rewritten = `${VEC_CMP[op]}(${inner.slice(0, i).trim()}, ${inner.slice(i + op.length).trim()})`;
        break;
      }
    }
    if (rewritten !== undefined) {
      s = s.slice(0, open + 1) + rewritten + s.slice(close);
    }
    from = open + 1;
  }
}

/** Rewrite one WGSL expression/statement fragment into GLSL. */
export function wgslExprToGlsl(src: string): string {
  let s = rewriteSelect(src);
  s = rewriteVecCompare(s);
  s = s.replace(/\bvec([234])f\(/g, 'vec$1(');
  s = s.replace(/\bf32\(/g, 'float(');
  s = s.replace(/\bu32\(/g, 'uint(');
  s = s.replace(/\bi32\(/g, 'int(');
  return s;
}

/**
 * Translate a generated WGSL body (init or update) into GLSL. `tempTypes` maps
 * every untyped `let` name (node temps `x_*`, output temps `t_*`) to its port
 * type; typed lets (`let x: vec2f = …`) carry their own type. Unknown temps
 * throw — that is a codegen bug, not an input error.
 */
export function wgslBodyToGlsl(body: string, tempTypes: ReadonlyMap<string, string>): string {
  if (body === '') return body;
  return body
    .split('\n')
    .map((line) => {
      let m = /^(\s*)let\s+([A-Za-z_]\w*)\s*:\s*(\w+)\s*=\s*(.*)$/.exec(line);
      if (m !== null) {
        const glslType = TYPE_GLSL[m[3]!];
        if (glslType === undefined) throw new Error(`webgl2 codegen: unknown WGSL type "${m[3]}"`);
        return `${m[1]}${glslType} ${m[2]} = ${wgslExprToGlsl(m[4]!)}`;
      }
      m = /^(\s*)let\s+([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line);
      if (m !== null) {
        const t = tempTypes.get(m[2]!);
        if (t === undefined) throw new Error(`webgl2 codegen: no recorded type for temp "${m[2]}"`);
        const glslType = TYPE_GLSL[t];
        if (glslType === undefined) throw new Error(`webgl2 codegen: unknown temp type "${t}"`);
        return `${m[1]}${glslType} ${m[2]} = ${wgslExprToGlsl(m[3]!)}`;
      }
      return wgslExprToGlsl(line);
    })
    .join('\n');
}
