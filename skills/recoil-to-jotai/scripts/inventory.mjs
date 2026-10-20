#!/usr/bin/env node
/**
 * Recoil inventory for a Recoil -> Jotai migration.
 *
 * Scans a TypeScript/TSX source tree with the project's own `typescript` package (no other
 * dependencies) and reports every Recoil feature (atom, selector, atomFamily, selectorFamily),
 * what it depends on, who consumes it and how, which Recoil APIs the code base uses, a
 * documented ease score per feature, and a migration plan: isolated features first, then the
 * connected components, cut into waves with the bridges each wave needs.
 *
 * Usage:
 *   node inventory.mjs <srcRoot> [--out <dir>] [--baseline <inventory.json>]
 *                      [--direction sinks-first|sources-first] [--check] [--quiet]
 *
 * Output: <out>/recoil-inventory.json and <out>/recoil-inventory.md
 * (default <out> = ./.recoil-to-jotai under the current directory).
 *
 * --check exits 1 while any scanned file still imports 'recoil' (the end-of-migration gate).
 * The `typescript` module is resolved from the project root; set RECOIL_TO_JOTAI_TS to the
 * path of a typescript package to override.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const DEFINITION_APIS = new Set(['atom', 'selector', 'atomFamily', 'selectorFamily']);
const WAIT_APIS = new Set(['waitForAll', 'waitForAny', 'waitForNone', 'waitForAllSettled']);
const HOOK_APIS = new Set([
  'useRecoilState',
  'useRecoilValue',
  'useSetRecoilState',
  'useResetRecoilState',
  'useRecoilValueLoadable',
  'useRecoilStateLoadable',
  'useRecoilRefresher_UNSTABLE',
]);
const CALLBACK_OPS = new Set(['getPromise', 'getLoadable', 'set', 'reset', 'refresh', 'getInfo_UNSTABLE']);
const LOADABLE_METHODS = ['valueMaybe', 'getValue', 'valueOrThrow', 'errorMaybe', 'errorOrThrow', 'toPromise', 'promiseMaybe', 'promiseOrThrow'];
const API_CATEGORY = {
  atom: 'definition',
  selector: 'definition',
  atomFamily: 'definition',
  selectorFamily: 'definition',
  useRecoilState: 'hook',
  useRecoilValue: 'hook',
  useSetRecoilState: 'hook',
  useResetRecoilState: 'hook',
  useRecoilValueLoadable: 'hook',
  useRecoilStateLoadable: 'hook',
  useRecoilCallback: 'hook',
  useRecoilRefresher_UNSTABLE: 'hook',
  RecoilRoot: 'root',
  useRecoilBridgeAcrossReactRoots_UNSTABLE: 'root',
  useRecoilSnapshot: 'snapshot',
  useGotoRecoilSnapshot: 'snapshot',
  snapshot_UNSTABLE: 'snapshot',
  useRecoilTransaction_UNSTABLE: 'snapshot',
  useRecoilTransactionObserver_UNSTABLE: 'snapshot',
  useRecoilStoreID: 'snapshot',
  useGetRecoilValueInfo_UNSTABLE: 'snapshot',
  waitForAll: 'util',
  waitForAny: 'util',
  waitForNone: 'util',
  waitForAllSettled: 'util',
  noWait: 'util',
  constSelector: 'util',
  errorSelector: 'util',
  isRecoilValue: 'util',
  DefaultValue: 'util',
  RecoilEnv: 'util',
  RecoilLoadable: 'util',
  Loadable: 'type',
  RecoilState: 'type',
  RecoilValue: 'type',
  RecoilValueReadOnly: 'type',
  SetterOrUpdater: 'type',
  Snapshot: 'type',
  MutableSnapshot: 'type',
  CallbackInterface: 'type',
  AtomEffect: 'type',
  GetRecoilValue: 'type',
  SetRecoilState: 'type',
  ResetRecoilState: 'type',
  CachePolicy: 'type',
  CachePolicyWithoutEquality: 'type',
};
// APIs with no mechanical Jotai equivalent: the agent has to decide per usage.
const DECISION_APIS = new Set([
  'useRecoilSnapshot',
  'useGotoRecoilSnapshot',
  'useRecoilTransaction_UNSTABLE',
  'useRecoilTransactionObserver_UNSTABLE',
  'useRecoilBridgeAcrossReactRoots_UNSTABLE',
  'useGetRecoilValueInfo_UNSTABLE',
  'useRecoilStoreID',
  'RecoilEnv',
  'isRecoilValue',
  'errorSelector',
  'constSelector',
  'waitForNone',
  'waitForAllSettled',
  'RecoilLoadable',
]);
// Mechanical mappings that still need a look at every use (callbacks, loadables, reset, types).
const CARE_APIS = [
  'useRecoilCallback',
  'useRecoilRefresher_UNSTABLE',
  'useResetRecoilState',
  'useRecoilValueLoadable',
  'useRecoilStateLoadable',
  'snapshot_UNSTABLE',
  'DefaultValue',
  'noWait',
  'waitForAll',
  'waitForAny',
  'RecoilLoadable',
  'Loadable',
  'RecoilState',
  'RecoilValue',
  'RecoilValueReadOnly',
  'AtomEffect',
  'Snapshot',
  'CallbackInterface',
  'SetterOrUpdater',
];
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo']);
const TEST_FILE = /\.(test|spec)\.[jt]sx?$|__tests__|\/tests?\//;
const SMALL_COMPONENT = 8; // components up to this size are proposed as one atomic change
const HUB_CUT_THRESHOLDS = [8, 12, 16, 24]; // batch sizes to compare in the hub-cut table
const FAMILY_HUB_WEIGHT = 0.5; // families make poor hubs: one bridge per parameter

// ---------------------------------------------------------------------------------------------
// CLI and environment
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { srcRoot: null, out: null, baseline: null, direction: 'sinks-first', check: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--baseline') args.baseline = argv[++i];
    else if (a === '--direction') args.direction = argv[++i];
    else if (a === '--check') args.check = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!args.srcRoot) args.srcRoot = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  if (!['sinks-first', 'sources-first'].includes(args.direction)) {
    throw new Error(`--direction must be sinks-first or sources-first, got ${args.direction}`);
  }
  return args;
}

function findUp(startDir, fileName) {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadTypescript(projectRoot) {
  const override = process.env.RECOIL_TO_JOTAI_TS;
  if (override) return createRequire(join(resolve(override), 'package.json'))('./');
  for (const base of [projectRoot, process.cwd()]) {
    try {
      return createRequire(join(base, 'package.json'))('typescript');
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'Could not load the `typescript` package. Run the inventory from a project that has typescript installed, ' +
      'or set RECOIL_TO_JOTAI_TS=/path/to/node_modules/typescript.',
  );
}

function listSourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) listSourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

function readPackageVersions(projectRoot) {
  const names = ['recoil', 'jotai', 'jotai-family', 'jotai-loadable', 'jotai-recoil-compat', 'react', 'next', 'typescript'];
  const pkgPath = join(projectRoot, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};
  const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const versions = {};
  for (const name of names) {
    const installedPath = join(projectRoot, 'node_modules', name, 'package.json');
    const installed = existsSync(installedPath) ? JSON.parse(readFileSync(installedPath, 'utf8')).version : null;
    if (declared[name] || installed) versions[name] = { declared: declared[name] || null, installed };
  }
  return versions;
}

function loadCompilerOptions(ts, srcRoot) {
  const fallback = { moduleResolution: ts.ModuleResolutionKind.Bundler };
  const tsconfigPath = findUp(srcRoot, 'tsconfig.json');
  if (!tsconfigPath) return { options: fallback, tsconfigPath: null };
  const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (error) return { options: fallback, tsconfigPath };
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dirname(tsconfigPath));
  return { options: parsed.options, tsconfigPath };
}

// ---------------------------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------------------------

function unwrapExpression(ts, node) {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
    } else if (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

function propertyName(ts, prop) {
  if (!prop.name) return null;
  if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) return prop.name.text;
  return null;
}

function isFunctionLike(ts, node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node);
}

function hasAsyncModifier(ts, node) {
  return Boolean(node.modifiers && node.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
}

/** Any function in the chain `(p) => async ({get}) => ...` or `async ({get}) => ...` marked async? */
function containsAsyncFunction(ts, node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (isFunctionLike(ts, n) && hasAsyncModifier(ts, n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Does the innermost read function return a call expression directly (e.g. `() => rest.get()`)? */
function returnsCallExpression(ts, node) {
  let fn = unwrapExpression(ts, node);
  for (let i = 0; i < 3 && ts.isArrowFunction(fn) && ts.isArrowFunction(unwrapExpression(ts, fn.body)); i += 1) {
    fn = unwrapExpression(ts, fn.body); // peel family wrappers: (param) => (opts) => body
  }
  if (!isFunctionLike(ts, fn) || !fn.body) return false;
  if (ts.isCallExpression(unwrapExpression(ts, fn.body))) return true;
  if (ts.isBlock(fn.body)) {
    return fn.body.statements.some((s) => ts.isReturnStatement(s) && s.expression && ts.isCallExpression(unwrapExpression(ts, s.expression)));
  }
  return false;
}

const PRIMITIVE_TYPE = /^(number|string|boolean|null|undefined|bigint|symbol|'[^']*'|"[^"]*"|\d+)(\s*\|\s*(number|string|boolean|null|undefined|bigint|symbol|'[^']*'|"[^"]*"|\d+))*$/;

function classifyParamType(typeText) {
  if (!typeText) return 'unknown';
  return PRIMITIVE_TYPE.test(typeText.trim()) ? 'primitive' : 'object';
}

/** Type of a family parameter: from `atomFamily<V, P>` type args or the `get: (param: P) =>` annotation. */
function familyParamType(ts, call, options, sf) {
  if (call.typeArguments && call.typeArguments.length >= 2) return call.typeArguments[1].getText(sf);
  for (const prop of [options.get, options.default]) {
    if (!prop) continue;
    const fn = unwrapExpression(ts, ts.isMethodDeclaration(prop) ? prop : prop.initializer);
    if (isFunctionLike(ts, fn) && fn.parameters[0]?.type) return fn.parameters[0].type.getText(sf);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------------------------

function collectImports(ts, sf) {
  const imports = new Map(); // local -> { module, name }
  const reexports = []; // { module, names: Map exported->original } | { module, star: true }
  const recoilLocals = new Map(); // local -> recoil API name
  const recoilNamespaces = new Set();
  const jotaiLocals = new Map();
  const jotaiModules = new Set();
  const recoilExtras = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const module = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (!clause) continue;
      const isRecoil = module === 'recoil';
      const isJotai = module === 'jotai' || module.startsWith('jotai/') || module.startsWith('jotai-');
      if (['recoil-relay', 'recoil-sync', 'recoil-persist', 'recoil-nexus'].includes(module)) recoilExtras.push(module);
      if (isJotai) jotaiModules.add(module);
      if (clause.name) imports.set(clause.name.text, { module, name: 'default' });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        imports.set(bindings.name.text, { module, name: '*' });
        if (isRecoil) recoilNamespaces.add(bindings.name.text);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const original = el.propertyName ? el.propertyName.text : el.name.text;
          imports.set(el.name.text, { module, name: original });
          if (isRecoil) recoilLocals.set(el.name.text, original);
          if (isJotai) jotaiLocals.set(el.name.text, original);
        }
      }
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const module = stmt.moduleSpecifier.text;
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        const names = new Map();
        for (const el of stmt.exportClause.elements) names.set(el.name.text, el.propertyName ? el.propertyName.text : el.name.text);
        reexports.push({ module, names });
      } else {
        reexports.push({ module, star: true });
      }
    }
  }
  return { imports, reexports, recoilLocals, recoilNamespaces, jotaiLocals, jotaiModules, recoilExtras };
}

class FileAnalyzer {
  constructor(ts, sf, filePath, ctx) {
    this.ts = ts;
    this.sf = sf;
    this.filePath = filePath;
    this.ctx = ctx; // { imports, recoilLocals, recoilNamespaces, jotaiLocals, knownNames }
    this.definitions = [];
    this.aliases = new Map(); // local alias -> local feature/import name
    this.references = []; // { localName, role, familyCall, paramLiteral, line }
    this.apiUsage = new Map();
    this.loadableIdioms = new Map();
    this.initializeStateCount = 0;
    this.jotaiDefinitions = 0;
    this.definitionDepth = 0;
    this.callbackDepth = 0;
  }

  line(node) {
    return this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf)).line + 1;
  }

  /** Name of the recoil API a callee refers to (handles aliases and namespace imports), else null. */
  recoilCallee(callee) {
    const { ts, ctx } = this;
    if (ts.isIdentifier(callee)) return ctx.recoilLocals.get(callee.text) || null;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && ctx.recoilNamespaces.has(callee.expression.text)) {
      return callee.name.text;
    }
    return null;
  }

  jotaiCallee(callee) {
    return this.ts.isIdentifier(callee) ? this.ctx.jotaiLocals.get(callee.text) || null : null;
  }

  bumpApi(api) {
    this.apiUsage.set(api, (this.apiUsage.get(api) || 0) + 1);
  }

  bumpIdiom(idiom) {
    this.loadableIdioms.set(idiom, (this.loadableIdioms.get(idiom) || 0) + 1);
  }

  analyze() {
    const { ts } = this;
    // Same-file definitions are referenceable before their statement is visited (e.g. `default: otherSelector`).
    for (const stmt of this.sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const init = unwrapExpression(ts, d.initializer);
        if (ts.isCallExpression(init) && DEFINITION_APIS.has(this.recoilCallee(init.expression) || '')) this.ctx.knownNames.add(d.name.text);
      }
    }
    // Aliases: `const f = (p) => familyX(p)` or `const f = featureX`. Resolved to the feature they wrap.
    for (const stmt of this.sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const init = unwrapExpression(ts, d.initializer);
        let target = null;
        if (ts.isIdentifier(init)) target = init.text;
        else if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          let body = init.body ? unwrapExpression(ts, init.body) : null;
          if (body && ts.isBlock(body)) {
            const ret = body.statements.find((st) => ts.isReturnStatement(st) && st.expression);
            body = ret ? unwrapExpression(ts, ret.expression) : null;
          }
          if (body && ts.isCallExpression(body) && ts.isIdentifier(body.expression)) target = body.expression.text;
        }
        if (target && target !== d.name.text && this.ctx.knownNames.has(target)) {
          this.aliases.set(d.name.text, target);
          this.ctx.knownNames.add(d.name.text);
        }
      }
    }
    const visit = (node) => this.visitNode(node, visit);
    ts.forEachChild(this.sf, visit);
  }

  visitNode(node, visit) {
    const { ts } = this;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;

    if (ts.isIdentifier(node) && !this.isNonReferenceIdentifier(node)) {
      if (this.ctx.recoilLocals.has(node.text)) this.bumpApi(this.ctx.recoilLocals.get(node.text));
      if (this.definitionDepth === 0 && this.callbackDepth === 0 && this.ctx.knownNames.has(node.text) && !this.coveredByCall(node)) {
        this.references.push({ localName: node.text, role: 'ref', familyCall: false, paramLiteral: false, line: this.line(node) });
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (ts.isIdentifier(node.expression) && this.ctx.recoilNamespaces.has(node.expression.text)) this.bumpApi(node.name.text);
      if (LOADABLE_METHODS.includes(node.name.text)) this.bumpIdiom(node.name.text);
      if (node.name.text === 'contents') this.bumpIdiom('.contents');
    }
    if (ts.isStringLiteral(node) && node.text === 'hasValue') this.bumpIdiom("'hasValue'");
    if (ts.isJsxAttribute(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(this.sf);
      if (name === 'initializeState') this.initializeStateCount += 1;
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrapExpression(ts, node.initializer);
      if (ts.isCallExpression(init)) {
        const api = this.recoilCallee(init.expression);
        if (api && DEFINITION_APIS.has(api)) {
          this.collectDefinition(node, init, api);
          this.definitionDepth += 1;
          ts.forEachChild(node, visit);
          this.definitionDepth -= 1;
          return;
        }
        const jotaiApi = this.jotaiCallee(init.expression);
        if (jotaiApi && /^atom/.test(jotaiApi)) this.jotaiDefinitions += 1;
      }
    }

    if (ts.isCallExpression(node)) {
      if (this.recoilCallee(node.expression) === 'useRecoilCallback') {
        this.callbackDepth += 1;
        ts.forEachChild(node, visit);
        this.callbackDepth -= 1;
        return;
      }
      if (this.definitionDepth === 0) this.collectConsumerCall(node);
    }

    ts.forEachChild(node, visit);
  }

  /** Identifiers that name things rather than reference them. */
  isNonReferenceIdentifier(identifier) {
    const { ts } = this;
    const parent = identifier.parent;
    if (!parent) return false;
    if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent)) return true;
    if (ts.isJsxClosingElement(parent)) return true;
    if ((ts.isVariableDeclaration(parent) || ts.isBindingElement(parent) || ts.isParameter(parent)) && parent.name === identifier) return true;
    if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === identifier) return true;
    return false;
  }

  /** Role of a call site for a feature passed as its first argument, or null when it is not a Recoil consumer call. */
  callRole(call) {
    const { ts } = this;
    const api = this.recoilCallee(call.expression);
    if (api && HOOK_APIS.has(api)) return api;
    if (ts.isIdentifier(call.expression) && ['set', 'reset', 'refresh'].includes(call.expression.text)) {
      return this.callbackDepth > 0 ? `useRecoilCallback:${call.expression.text}` : `imperative:${call.expression.text}`;
    }
    if (ts.isPropertyAccessExpression(call.expression) && CALLBACK_OPS.has(call.expression.name.text)) {
      return this.callbackDepth > 0 ? `useRecoilCallback:${call.expression.name.text}` : `snapshot:${call.expression.name.text}`;
    }
    return null;
  }

  /** Is this identifier already recorded through collectConsumerCall (hook/callback argument, possibly via a family call)? */
  coveredByCall(identifier) {
    const { ts } = this;
    let node = identifier;
    if (ts.isCallExpression(node.parent) && node.parent.expression === node) node = node.parent; // family call `fam(param)`
    const call = node.parent;
    return Boolean(call && ts.isCallExpression(call) && call.arguments[0] === node && this.callRole(call));
  }

  /** Collect a feature definition: options, flags and dependencies read inside its functions. */
  collectDefinition(decl, call, kind) {
    const { ts, sf } = this;
    const options = {};
    const arg0 = call.arguments[0] ? unwrapExpression(ts, call.arguments[0]) : null;
    if (arg0 && ts.isObjectLiteralExpression(arg0)) {
      for (const prop of arg0.properties) {
        const name = propertyName(ts, prop);
        if (name) options[name] = prop;
      }
    }
    const keyProp = options.key;
    const key = keyProp && ts.isPropertyAssignment(keyProp) && ts.isStringLiteral(keyProp.initializer) ? keyProp.initializer.text : null;
    const text = call.getText(sf);
    const getNode = options.get ? (ts.isMethodDeclaration(options.get) ? options.get : options.get.initializer) : null;
    const defaultNode = options.default && ts.isPropertyAssignment(options.default) ? unwrapExpression(ts, options.default.initializer) : null;

    let defaultKind = null;
    if (defaultNode) {
      if (ts.isCallExpression(defaultNode)) {
        const api = this.recoilCallee(defaultNode.expression);
        if (api && DEFINITION_APIS.has(api)) defaultKind = api;
        else if (ts.isIdentifier(defaultNode.expression) && this.ctx.knownNames.has(defaultNode.expression.text)) defaultKind = 'feature';
      } else if (ts.isIdentifier(defaultNode) && this.ctx.knownNames.has(defaultNode.text)) {
        defaultKind = 'feature';
      } else if (isFunctionLike(ts, defaultNode)) {
        defaultKind = 'function';
      }
    }

    const deps = [];
    const waits = new Set();
    let usesNoWait = false;
    const collectDeps = (n) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        let via = null;
        if (ts.isIdentifier(callee) && ['get', 'set', 'reset', 'refresh'].includes(callee.text)) via = callee.text;
        else if (ts.isPropertyAccessExpression(callee) && CALLBACK_OPS.has(callee.name.text)) via = callee.name.text;
        if (via && n.arguments[0]) {
          const valueUnused = via === 'get' && Boolean(n.parent) && ts.isExpressionStatement(n.parent); // `get(tick);` as a bare statement
          for (const target of this.refTargets(n.arguments[0], waits)) {
            if (target.wrapper === 'noWait') usesNoWait = true;
            deps.push({ ...target, via, valueUnused });
          }
        }
      }
      ts.forEachChild(n, collectDeps);
    };
    collectDeps(call);

    const effectsProp = options.effects || options.effects_UNSTABLE;
    let effectsCount = 0;
    if (effectsProp) {
      const init = ts.isPropertyAssignment(effectsProp) ? unwrapExpression(ts, effectsProp.initializer) : null;
      effectsCount = init && ts.isArrayLiteralExpression(init) ? init.elements.length : 1;
    }
    const isFamily = kind === 'atomFamily' || kind === 'selectorFamily';
    const paramType = isFamily ? familyParamType(ts, call, options, sf) : null;

    this.definitions.push({
      name: decl.name.text,
      exported: (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Export) !== 0,
      kind,
      key,
      file: this.filePath,
      line: this.line(decl),
      flags: {
        isAsync: Boolean(getNode && containsAsyncFunction(ts, getNode)) || Boolean(defaultNode && containsAsyncFunction(ts, defaultNode)),
        maybeAsync: /\bawait\b|\.then\(|\bPromise\b/.test(text) || Boolean(getNode && returnsCallExpression(ts, getNode)),
        hasSet: Boolean(options.set),
        usesDefaultValue: /\bDefaultValue\b/.test(text),
        hasEffects: effectsCount > 0,
        effectsCount,
        hasCachePolicy: Boolean(options.cachePolicy_UNSTABLE),
        dangerouslyAllowMutability: Boolean(options.dangerouslyAllowMutability),
        ssrGuard: /typeof window/.test(text),
        defaultKind,
        paramType,
        paramKind: isFamily ? classifyParamType(paramType) : null,
        usesWaitFor: [...waits],
        usesNoWait,
      },
      rawDeps: deps,
    });
  }

  /** Resolve the argument of get/set/reset/... to the features it refers to. */
  refTargets(arg, waits) {
    const { ts } = this;
    const node = unwrapExpression(ts, arg);
    if (ts.isIdentifier(node)) return [{ localName: node.text, familyCall: false, paramLiteral: false, wrapper: null }];
    if (ts.isCallExpression(node)) {
      const api = this.recoilCallee(node.expression);
      if (api && WAIT_APIS.has(api)) {
        waits.add(api);
        const inner = node.arguments[0] ? unwrapExpression(ts, node.arguments[0]) : null;
        let elements = [];
        if (inner && ts.isArrayLiteralExpression(inner)) elements = inner.elements;
        else if (inner && ts.isObjectLiteralExpression(inner)) elements = inner.properties.map((p) => (ts.isPropertyAssignment(p) ? p.initializer : p.name));
        return elements.flatMap((el) => this.refTargets(el, waits).map((t) => ({ ...t, wrapper: api })));
      }
      if (api === 'noWait' && node.arguments[0]) {
        return this.refTargets(node.arguments[0], waits).map((t) => ({ ...t, wrapper: 'noWait' }));
      }
      if (ts.isIdentifier(node.expression)) {
        const param = node.arguments[0] ? unwrapExpression(ts, node.arguments[0]) : null;
        const paramLiteral = Boolean(param && (ts.isObjectLiteralExpression(param) || ts.isArrayLiteralExpression(param)));
        return [{ localName: node.expression.text, familyCall: true, paramLiteral, wrapper: null }];
      }
    }
    return [];
  }

  collectConsumerCall(call) {
    const role = this.callRole(call);
    if (!role || !call.arguments[0]) return;
    for (const target of this.refTargets(call.arguments[0], new Set())) {
      this.references.push({ ...target, role, line: this.line(call) });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Cross-file resolution
// ---------------------------------------------------------------------------------------------

function makeResolver(ts, compilerOptions, scannedFiles) {
  const cache = new Map();
  return (moduleName, containingFile) => {
    const cacheKey = `${containingFile}\u0000${moduleName}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    let result = null;
    const resolved = ts.resolveModuleName(moduleName, containingFile, compilerOptions, ts.sys).resolvedModule;
    if (resolved && !resolved.isExternalLibraryImport) {
      const candidate = resolve(resolved.resolvedFileName);
      if (scannedFiles.has(candidate)) result = candidate;
    }
    if (!result && moduleName.startsWith('.')) {
      const base = resolve(dirname(containingFile), moduleName);
      for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
        if (scannedFiles.has(base + suffix)) {
          result = base + suffix;
          break;
        }
      }
    }
    cache.set(cacheKey, result);
    return result;
  };
}

/** Feature id (`file#name`) that `name` exported from `file` refers to, following re-exports. */
function resolveExport(file, name, fileInfos, resolveModule, depth = 0) {
  const info = fileInfos.get(file);
  if (!info || depth > 5) return null;
  if (info.definitionNames.has(name)) return `${file}#${name}`;
  if (info.aliases.has(name)) return resolveAlias(file, info.aliases.get(name), fileInfos, resolveModule, depth + 1);
  for (const re of info.reexports) {
    const target = resolveModule(re.module, file);
    if (!target) continue;
    if (re.star) {
      const found = resolveExport(target, name, fileInfos, resolveModule, depth + 1);
      if (found) return found;
    } else if (re.names.has(name)) {
      const found = resolveExport(target, re.names.get(name), fileInfos, resolveModule, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** An alias target is a local name in `file`: a definition or an import. */
function resolveAlias(file, targetName, fileInfos, resolveModule, depth) {
  const info = fileInfos.get(file);
  if (info.definitionNames.has(targetName)) return `${file}#${targetName}`;
  const imp = info.imports.get(targetName);
  if (!imp) return null;
  const target = resolveModule(imp.module, file);
  return target ? resolveExport(target, imp.name, fileInfos, resolveModule, depth) : null;
}

function resolveLocalName(file, localName, fileInfos, resolveModule, uniqueByName) {
  const info = fileInfos.get(file);
  if (info.definitionNames.has(localName)) return { id: `${file}#${localName}`, how: 'local' };
  if (info.aliases.has(localName)) {
    const id = resolveAlias(file, info.aliases.get(localName), fileInfos, resolveModule, 0);
    if (id) return { id, how: 'alias' };
  }
  const imp = info.imports.get(localName);
  if (imp) {
    if (imp.module === 'recoil') return { id: null, how: 'recoil-api' };
    if (imp.module === 'jotai' || imp.module.startsWith('jotai/') || imp.module.startsWith('jotai-')) return { id: null, how: 'jotai-api' };
    const target = resolveModule(imp.module, file);
    if (target) {
      const id = resolveExport(target, imp.name, fileInfos, resolveModule);
      if (id) return { id, how: 'import' };
      return { id: null, how: `not-a-recoil-feature:${imp.module}` };
    }
    const unique = uniqueByName.get(imp.name);
    if (unique) return { id: unique, how: 'unique-name' };
    return { id: null, how: `unresolved:${imp.module}` };
  }
  const unique = uniqueByName.get(localName);
  if (unique) return { id: unique, how: 'unique-name' };
  return { id: null, how: 'unknown' };
}

// ---------------------------------------------------------------------------------------------
// Graph: components, cycles, waves, bridges
// ---------------------------------------------------------------------------------------------

export function tarjanScc(ids, depsOf) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlink = new Map();
  const sccs = [];
  const strongConnect = (v) => {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of depsOf(v)) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }
    if (lowlink.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  };
  for (const id of ids) if (!indices.has(id)) strongConnect(id);
  return sccs;
}

export function weaklyConnectedComponents(ids, neighbours) {
  const seen = new Set();
  const components = [];
  for (const start of ids) {
    if (seen.has(start)) continue;
    const comp = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const v = queue.pop();
      comp.push(v);
      for (const w of neighbours(v)) {
        if (!seen.has(w)) {
          seen.add(w);
          queue.push(w);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

/**
 * Hub cut: greedily remove the highest-degree features of a component until what is left falls
 * apart into fragments of at most `threshold` features. The hubs are bridged for the whole
 * migration (one bridge each); every fragment then moves atomically, in any order.
 */
export function hubCut(memberIds, depsOf, dependentsOf, threshold, isFamily = () => false) {
  const remaining = new Set(memberIds);
  const within = (ids) => ids.filter((id) => remaining.has(id));
  const neighbours = (id) => [...within(depsOf(id)), ...within(dependentsOf(id))];
  const hubs = [];
  for (;;) {
    const comps = weaklyConnectedComponents([...remaining], neighbours).sort((a, b) => b.length - a.length);
    if (!comps.length || comps[0].length <= threshold) break;
    let hubId = null;
    let best = -1;
    for (const id of comps[0]) {
      const degree = neighbours(id).length;
      const score = isFamily(id) ? degree * FAMILY_HUB_WEIGHT : degree; // a family hub needs one bridge per parameter
      if (score > best) {
        best = score;
        hubId = id;
      }
    }
    hubs.push({ id: hubId, degree: neighbours(hubId).length });
    remaining.delete(hubId);
  }
  const hubIds = new Set(hubs.map((h) => h.id));
  const fragments = weaklyConnectedComponents([...remaining], neighbours)
    .sort((a, b) => b.length - a.length)
    .map((members) => {
      const reads = new Set();
      const writes = new Set();
      for (const id of members) {
        for (const d of depsOf(id, true)) {
          if (!hubIds.has(d.id)) continue;
          if (d.via === 'set' || d.via === 'reset') writes.add(d.id);
          else reads.add(d.id);
        }
      }
      return { members, size: members.length, readsHubs: [...reads], writesHubs: [...writes] };
    });
  return { hubs, fragments, bridgesAlive: hubs.length, anyFragmentWritesHub: fragments.some((f) => f.writesHubs.length > 0) };
}

/**
 * Cut a component into waves. sinks-first: a feature moves once everything that READS it has
 * moved (its still-Recoil dependencies are mirrored into Jotai). sources-first: a feature moves
 * once everything it READS has moved (its still-Recoil dependents read a shadow of it).
 */
export function planWaves(memberIds, depsOf, dependentsOf, direction) {
  const members = new Set(memberIds);
  const sccs = tarjanScc(memberIds, (v) => depsOf(v).filter((d) => members.has(d)));
  const sccOf = new Map();
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));
  const sccDeps = sccs.map(() => new Set());
  const sccDependents = sccs.map(() => new Set());
  for (const id of memberIds) {
    for (const d of depsOf(id)) {
      if (!members.has(d) || sccOf.get(d) === sccOf.get(id)) continue;
      sccDeps[sccOf.get(id)].add(sccOf.get(d));
      sccDependents[sccOf.get(d)].add(sccOf.get(id));
    }
  }
  const levelFrom = direction === 'sinks-first' ? sccDependents : sccDeps;
  const level = new Array(sccs.length).fill(0);
  const computeLevel = (i) => {
    if (level[i]) return level[i];
    level[i] = 1;
    let max = 0;
    for (const j of levelFrom[i]) max = Math.max(max, computeLevel(j));
    level[i] = max + 1;
    return level[i];
  };
  sccs.forEach((_, i) => computeLevel(i));
  const waveCount = Math.max(0, ...level);
  const waves = [];
  const migrated = new Set();
  let alive = new Set();
  for (let w = 1; w <= waveCount; w += 1) {
    const features = sccs.flatMap((scc, i) => (level[i] === w ? scc : []));
    features.forEach((id) => migrated.add(id));
    const needed = new Set();
    for (const id of migrated) {
      const others = direction === 'sinks-first' ? depsOf(id) : dependentsOf(id);
      for (const o of others) if (members.has(o) && !migrated.has(o)) needed.add(o);
    }
    const newBridges = [...needed].filter((b) => !alive.has(b));
    const retired = [...alive].filter((b) => !needed.has(b));
    alive = needed;
    waves.push({ wave: w, features, newBridges, retiredBridges: retired, aliveBridges: needed.size });
  }
  const cycles = sccs.filter((scc) => scc.length > 1);
  return { waves, cycles, maxAliveBridges: Math.max(0, ...waves.map((w) => w.aliveBridges)) };
}

// ---------------------------------------------------------------------------------------------
// Ease score
// ---------------------------------------------------------------------------------------------

const EASE_RUBRIC = [
  'Start from the kind: atom 5, atomFamily 4, selector 4, selectorFamily 3.',
  '-1 atom effects (persistence/validation/reset semantics must be rebuilt, storage layout decided).',
  '-1 writable with DefaultValue handling (reset must be re-expressed with RESET).',
  '-1 default is another selector/selectorFamily/feature (atomWithDefault + resettable semantics).',
  '-1 family keyed by an object parameter (Recoil compares by value, Jotai by reference: areEqual needed).',
  '-1 application code reads it as a Loadable (loadable shape and method idioms change).',
  '-1 application code touches it imperatively (useRecoilCallback, refresher, initializeState, snapshots).',
  '-1 more than 10 consumer files.',
  '-1 uses waitFor*/noWait inside its read.',
  '-1 a dependency could not be resolved (verify by hand).',
  'Clamped to 1..5. Test files count as consumers but do not lower the score; they are flagged as "tests".',
];

function scoreEase(feature) {
  let score = { atom: 5, atomFamily: 4, selector: 4, selectorFamily: 3 }[feature.kind];
  const reasons = [];
  const f = feature.flags;
  const appRoles = new Set(feature.consumers.filter((c) => !c.isTest).flatMap((c) => Object.keys(c.roles)));
  const penalise = (cond, reason) => {
    if (cond) {
      score -= 1;
      reasons.push(reason);
    }
  };
  penalise(f.hasEffects, 'effects');
  penalise(f.hasSet && f.usesDefaultValue, 'DefaultValue reset');
  penalise(['selector', 'selectorFamily', 'feature', 'atom', 'atomFamily'].includes(f.defaultKind), 'derived default');
  penalise(f.paramKind === 'object', 'object param');
  penalise(appRoles.has('useRecoilValueLoadable') || appRoles.has('useRecoilStateLoadable'), 'loadable consumers');
  penalise([...appRoles].some((r) => /^(useRecoilCallback|imperative|snapshot)/.test(r) || r === 'useRecoilRefresher_UNSTABLE'), 'imperative consumers');
  penalise(feature.consumers.length > 10, `${feature.consumers.length} consumer files`);
  penalise(f.usesWaitFor.length > 0 || f.usesNoWait, 'waitFor/noWait');
  penalise(feature.unresolvedDeps.length > 0, 'unresolved dep');
  return { score: Math.max(1, Math.min(5, score)), reasons };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function countBy(values) {
  const out = {};
  for (const v of values) out[v] = (out[v] || 0) + 1;
  return out;
}

function run(args) {
  const srcRoot = resolve(args.srcRoot);
  if (!existsSync(srcRoot)) throw new Error(`srcRoot does not exist: ${srcRoot}`);
  const pkgJson = findUp(srcRoot, 'package.json');
  const projectRoot = pkgJson ? dirname(pkgJson) : srcRoot;
  const ts = loadTypescript(projectRoot);
  const { options: compilerOptions, tsconfigPath } = loadCompilerOptions(ts, srcRoot);
  const files = listSourceFiles(srcRoot).map((f) => resolve(f));
  const scannedFiles = new Set(files);
  const resolveModule = makeResolver(ts, compilerOptions, scannedFiles);
  const rel = (p) => relative(projectRoot, p);
  const relId = (id) => {
    const i = id.lastIndexOf('#');
    return `${rel(id.slice(0, i))}#${id.slice(i + 1)}`;
  };
  const relIds = (ids) => ids.map(relId);
  const relComponent = (c) => ({
    ...c,
    members: relIds(c.members),
    waves: c.waves.map((w) => ({ ...w, features: relIds(w.features), newBridges: relIds(w.newBridges), retiredBridges: relIds(w.retiredBridges) })),
    cycles: c.cycles.map(relIds),
    hubCut: c.hubCut
      ? {
          ...c.hubCut,
          hubs: c.hubCut.hubs.map((h) => ({ ...h, id: relId(h.id) })),
          fragments: c.hubCut.fragments.map((f) => ({ ...f, members: relIds(f.members), readsHubs: relIds(f.readsHubs), writesHubs: relIds(f.writesHubs) })),
        }
      : null,
  });

  const fileInfos = new Map();
  const extras = new Map();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!/recoil|jotai/.test(text)) continue; // nothing to learn from this file
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const imported = collectImports(ts, sf);
    for (const m of imported.recoilExtras) extras.set(m, (extras.get(m) || 0) + 1);
    const ctx = { ...imported, knownNames: new Set(imported.imports.keys()) };
    const analyzer = new FileAnalyzer(ts, sf, file, ctx);
    analyzer.analyze();
    fileInfos.set(file, {
      imports: imported.imports,
      reexports: imported.reexports,
      importsRecoil: imported.recoilLocals.size > 0 || imported.recoilNamespaces.size > 0,
      jotaiModules: [...imported.jotaiModules],
      jotaiDefinitions: analyzer.jotaiDefinitions,
      definitionNames: new Set(analyzer.definitions.map((d) => d.name)),
      aliases: analyzer.aliases,
      definitions: analyzer.definitions,
      references: analyzer.references,
      apiUsage: analyzer.apiUsage,
      loadableIdioms: analyzer.loadableIdioms,
      initializeStateCount: analyzer.initializeStateCount,
      isTest: TEST_FILE.test(file),
    });
  }

  // Feature index
  const features = new Map();
  const byName = new Map();
  for (const [file, info] of fileInfos) {
    for (const d of info.definitions) {
      const id = `${file}#${d.name}`;
      features.set(id, { id, ...d, deps: [], dependents: [], consumers: [], unresolvedDeps: [], crossRuntimeDeps: [] });
      byName.set(d.name, (byName.get(d.name) || []).concat(id));
    }
  }
  const uniqueByName = new Map([...byName].filter(([, ids]) => ids.length === 1).map(([n, ids]) => [n, ids[0]]));

  // Dependencies
  for (const feature of features.values()) {
    const seen = new Set();
    for (const raw of feature.rawDeps) {
      const { id, how } = resolveLocalName(feature.file, raw.localName, fileInfos, resolveModule, uniqueByName);
      if (id && features.has(id)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const dep = { id, via: raw.via, wrapper: raw.wrapper, familyCall: raw.familyCall, paramLiteral: raw.paramLiteral, valueUnused: Boolean(raw.valueUnused) };
        if (id === feature.id) dep.self = true;
        else features.get(id).dependents.push(feature.id);
        feature.deps.push(dep);
      } else if (how === 'jotai-api') {
        feature.crossRuntimeDeps.push(raw.localName);
      } else if (how.startsWith('unresolved:')) {
        feature.unresolvedDeps.push(`${raw.localName} (${how.slice('unresolved:'.length)})`);
      }
      // 'recoil-api', 'not-a-recoil-feature:*' and 'unknown' are plain values, not state
    }
    delete feature.rawDeps;
    feature.dependents = [...new Set(feature.dependents)];
  }

  // Consumers
  for (const [file, info] of fileInfos) {
    const perFeature = new Map();
    for (const ref of info.references) {
      const { id } = resolveLocalName(file, ref.localName, fileInfos, resolveModule, uniqueByName);
      if (!id || !features.has(id)) continue;
      if (!perFeature.has(id)) perFeature.set(id, { file, isTest: info.isTest, roles: {}, familyParamLiteral: false, lines: [] });
      const entry = perFeature.get(id);
      entry.roles[ref.role] = (entry.roles[ref.role] || 0) + 1;
      if (ref.paramLiteral) entry.familyParamLiteral = true;
      if (entry.lines.length < 5) entry.lines.push(ref.line);
    }
    for (const [id, entry] of perFeature) features.get(id).consumers.push(entry);
  }
  const READ_ROLES = /^(useRecoilValue|useRecoilState|useRecoilValueLoadable|useRecoilStateLoadable|useRecoilCallback:get|snapshot:get)/;
  for (const feature of features.values()) {
    feature.consumers.sort((a, b) => a.file.localeCompare(b.file));
    feature.hasTests = feature.consumers.some((c) => c.isTest);
    // A refresh counter: an atom read only as `get(x);` (value unused) and never read by components.
    const incoming = feature.dependents.map((d) => features.get(d).deps.find((e) => e.id === feature.id));
    feature.flags.refreshCounter =
      feature.kind === 'atom' &&
      incoming.length > 0 &&
      incoming.every((e) => e && e.via === 'get' && e.valueUnused) &&
      !feature.consumers.some((c) => Object.keys(c.roles).some((r) => READ_ROLES.test(r)));
    feature.ease = scoreEase(feature);
  }

  // Graph analysis
  const ids = [...features.keys()];
  const depsOf = (id, detailed = false) => features.get(id).deps.filter((d) => !d.self).map((d) => (detailed ? d : d.id));
  const dependentsOf = (id) => features.get(id).dependents;
  const neighbours = (id) => [...depsOf(id), ...dependentsOf(id)];
  const wccs = weaklyConnectedComponents(ids, neighbours).sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  const otherDirection = args.direction === 'sinks-first' ? 'sources-first' : 'sinks-first';
  const components = wccs.map((members, i) => {
    const plan = planWaves(members, depsOf, dependentsOf, args.direction);
    const alt = planWaves(members, depsOf, dependentsOf, otherDirection);
    const isFamily = (id) => features.get(id).kind.endsWith('Family');
    const cut = members.length > SMALL_COMPONENT ? hubCut(members, depsOf, dependentsOf, SMALL_COMPONENT, isFamily) : null;
    const cutOptions = cut
      ? HUB_CUT_THRESHOLDS.filter((t) => t < members.length).map((t) => {
          const c = hubCut(members, depsOf, dependentsOf, t, isFamily);
          return { threshold: t, hubs: c.hubs.length, fragments: c.fragments.length, largestFragment: c.fragments[0]?.size || 0 };
        })
      : [];
    members.forEach((id) => {
      features.get(id).component = i + 1;
      const wave = plan.waves.find((w) => w.features.includes(id));
      features.get(id).wave = wave ? wave.wave : 1;
      if (cut) {
        const hubIndex = cut.hubs.findIndex((h) => h.id === id);
        features.get(id).fragment = hubIndex >= 0 ? 'hub' : cut.fragments.findIndex((f) => f.members.includes(id)) + 1;
      }
    });
    return {
      id: i + 1,
      size: members.length,
      members,
      kinds: countBy(members.map((id) => features.get(id).kind)),
      atomic: members.length <= SMALL_COMPONENT,
      direction: args.direction,
      waves: plan.waves,
      cycles: plan.cycles,
      maxAliveBridges: plan.maxAliveBridges,
      otherDirection,
      otherDirectionMaxAliveBridges: alt.maxAliveBridges,
      hubCut: cut
        ? {
            hubs: cut.hubs.map((h) => ({ ...h, kind: features.get(h.id).kind, consumerFiles: features.get(h.id).consumers.length })),
            fragments: cut.fragments,
            largestFragment: cut.fragments[0]?.size || 0,
            bridgesAlive: cut.bridgesAlive,
            options: cutOptions,
            recommendedOrder: cut.anyFragmentWritesHub || cut.hubs.every((h) => features.get(h.id).kind.startsWith('atom')) ? 'hubs-first' : 'hubs-last',
            anyFragmentWritesHub: cut.anyFragmentWritesHub,
          }
        : null,
    };
  });

  // API usage, idioms, decisions
  const apiUsage = {};
  const loadableIdioms = {};
  const decisions = {};
  let initializeStateFiles = [];
  let recoilFiles = 0;
  let jotaiFiles = 0;
  let jotaiDefinitions = 0;
  for (const [file, info] of fileInfos) {
    if (info.importsRecoil) recoilFiles += 1;
    if (info.jotaiModules.length) jotaiFiles += 1;
    jotaiDefinitions += info.jotaiDefinitions;
    if (info.initializeStateCount) initializeStateFiles.push(rel(file));
    for (const [api, count] of info.apiUsage) {
      apiUsage[api] = apiUsage[api] || { category: API_CATEGORY[api] || 'other', count: 0, files: 0 };
      apiUsage[api].count += count;
      apiUsage[api].files += 1;
      if (DECISION_APIS.has(api)) {
        decisions[api] = decisions[api] || { count: 0, files: [] };
        decisions[api].count += count;
        if (decisions[api].files.length < 8) decisions[api].files.push(rel(file));
      }
    }
    if (!info.importsRecoil) continue;
    for (const [idiom, count] of info.loadableIdioms) {
      loadableIdioms[idiom] = loadableIdioms[idiom] || { count: 0, files: 0 };
      loadableIdioms[idiom].count += count;
      loadableIdioms[idiom].files += 1;
    }
  }
  for (const [module, count] of extras) decisions[`import ${module}`] = { count, files: [] };
  const where = (list) => list.slice(0, 8).map((f) => `${rel(f.file)}:${f.line} ${f.name}`);
  const effectsFeatures = [...features.values()].filter((f) => f.flags.hasEffects);
  if (effectsFeatures.length) decisions['atom effects'] = { count: effectsFeatures.length, files: where(effectsFeatures) };
  if (initializeStateFiles.length) decisions['RecoilRoot initializeState'] = { count: initializeStateFiles.length, files: initializeStateFiles };
  const objectFamilies = [...features.values()].filter((f) => f.flags.paramKind === 'object');
  if (objectFamilies.length) decisions['families with object params'] = { count: objectFamilies.length, files: where(objectFamilies) };
  const crossRuntime = [...features.values()].filter((f) => f.crossRuntimeDeps.length);
  if (crossRuntime.length) decisions['cross-runtime reads (Recoil reading Jotai)'] = { count: crossRuntime.length, files: crossRuntime.map((f) => `${rel(f.file)}:${f.line} ${f.name} -> ${f.crossRuntimeDeps.join(', ')}`) };
  const counters = [...features.values()].filter((f) => f.flags.refreshCounter);
  if (counters.length) decisions['refresh counters (fold each with its selector into one atomWithRefresh)'] = { count: counters.length, files: where(counters) };
  const unresolved = [...features.values()].filter((f) => f.unresolvedDeps.length);
  if (unresolved.length) decisions['unresolved dependencies'] = { count: unresolved.length, files: unresolved.slice(0, 8).map((f) => `${rel(f.file)}:${f.line} ${f.name} -> ${f.unresolvedDeps.join(', ')}`) };

  // Baseline comparison
  let baseline = null;
  if (args.baseline) {
    const prev = JSON.parse(readFileSync(resolve(args.baseline), 'utf8'));
    const keyOf = (f) => `${f.name}:${f.kind}`;
    const prevKeys = new Set(prev.features.map(keyOf));
    const currentKeys = new Set([...features.values()].map(keyOf));
    baseline = {
      path: resolve(args.baseline),
      generatedAt: prev.generatedAt,
      total: prev.features.length,
      gone: [...prevKeys].filter((k) => !currentKeys.has(k)).sort(),
      added: [...currentKeys].filter((k) => !prevKeys.has(k)).sort(),
    };
  }

  const attention = {};
  for (const api of CARE_APIS) if (apiUsage[api]) attention[api] = apiUsage[api];
  const output = {
    generatedAt: new Date().toISOString(),
    projectRoot,
    srcRoot: rel(srcRoot) || '.',
    tsconfig: tsconfigPath ? rel(tsconfigPath) : null,
    filesScanned: files.length,
    filesParsed: fileInfos.size,
    versions: readPackageVersions(projectRoot),
    totals: {
      features: features.size,
      byKind: countBy([...features.values()].map((f) => f.kind)),
      filesImportingRecoil: recoilFiles,
      filesImportingJotai: jotaiFiles,
      jotaiDefinitions,
      consumerFiles: new Set([...features.values()].flatMap((f) => f.consumers.map((c) => c.file))).size,
      easeDistribution: countBy([...features.values()].map((f) => String(f.ease.score))),
      freeFeatures: components.filter((c) => c.size === 1).length,
      components: components.filter((c) => c.size > 1).length,
      largestComponent: components[0]?.size || 0,
    },
    apiUsage,
    attention,
    loadableIdioms,
    decisions,
    baseline,
    plan: {
      direction: args.direction,
      smallComponentMax: SMALL_COMPONENT,
      free: components.filter((c) => c.size === 1).map((c) => relId(c.members[0])),
      components: components.filter((c) => c.size > 1).map(relComponent),
    },
    features: [...features.values()]
      .sort((a, b) => a.component - b.component || a.wave - b.wave || b.ease.score - a.ease.score || a.name.localeCompare(b.name))
      .map((f) => ({
        ...f,
        id: relId(f.id),
        file: rel(f.file),
        deps: f.deps.map((d) => ({ ...d, id: relId(d.id) })),
        dependents: f.dependents.map(relId),
        consumers: f.consumers.map((c) => ({ ...c, file: rel(c.file) })),
      })),
    easeRubric: EASE_RUBRIC,
  };

  const outDir = resolve(args.out || join(process.cwd(), '.recoil-to-jotai'));
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, 'recoil-inventory.json');
  const mdPath = join(outDir, 'recoil-inventory.md');
  writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  writeFileSync(mdPath, renderMarkdown(output));

  if (!args.quiet) {
    const t = output.totals;
    console.log(
      `Recoil inventory: ${t.features} features (${Object.entries(t.byKind).map(([k, v]) => `${v} ${k}`).join(', ')}) in ${t.filesImportingRecoil} files importing recoil; ` +
        `${t.freeFeatures} free, ${t.components} connected components (largest ${t.largestComponent}).`,
    );
    const decisionCount = Object.values(decisions).reduce((n, d) => n + d.count, 0);
    const idiomUses = Object.values(loadableIdioms).reduce((n, i) => n + i.count, 0);
    const attentionUses = Object.values(attention).reduce((n, a) => n + a.count, 0);
    console.log(`Needs a decision: ${Object.keys(decisions).length} items (${decisionCount} places); mechanical-but-check APIs: ${attentionUses} uses; loadable idioms: ${idiomUses} uses in ${Object.values(loadableIdioms).reduce((n, i) => Math.max(n, i.files), 0)}+ files.`);
    const big = components[0];
    if (big?.hubCut) console.log(`Largest component: hub cut = ${big.hubCut.hubs.length} hubs -> ${big.hubCut.fragments.length} fragments (largest ${big.hubCut.largestFragment}), ${big.hubCut.bridgesAlive} bridges alive; waves = ${big.waves.length} waves, ${big.maxAliveBridges} bridges alive (${big.direction}).`);
    if (baseline) console.log(`Since baseline (${baseline.generatedAt}): ${baseline.gone.length} of ${baseline.total} gone, ${baseline.added.length} added.`);
    console.log(`Wrote ${jsonPath}\nWrote ${mdPath}`);
  }
  if (args.check) {
    const remaining = [...fileInfos].filter(([, i]) => i.importsRecoil).map(([f]) => rel(f));
    if (remaining.length) {
      console.error(`--check: ${remaining.length} file(s) still import 'recoil':\n  ${remaining.slice(0, 50).join('\n  ')}${remaining.length > 50 ? '\n  …' : ''}`);
      return 1;
    }
    console.log('--check: no file imports recoil.');
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------------------------

function renderMarkdown(o) {
  const nameOf = (id) => id.slice(id.lastIndexOf('#') + 1);
  const code = (ids) => ids.map((id) => `\`${nameOf(id)}\``).join(', ') || '—';
  const t = o.totals;
  const lines = ['# Recoil → Jotai inventory', ''];
  lines.push(`Generated ${o.generatedAt} for \`${o.projectRoot}\` (scanned \`${o.srcRoot}\`: ${o.filesScanned} files, ${o.filesParsed} mention recoil/jotai; tsconfig: ${o.tsconfig ? `\`${o.tsconfig}\`` : 'none'}).`, '');
  lines.push('## Versions', '', '| Package | Declared | Installed |', '| --- | --- | --- |');
  for (const [name, v] of Object.entries(o.versions)) lines.push(`| ${name} | ${v.declared || '—'} | ${v.installed || '—'} |`);
  lines.push('', '## Totals', '');
  lines.push(`- Recoil features: **${t.features}** (${Object.entries(t.byKind).map(([k, v]) => `${v} ${k}`).join(', ')}).`);
  lines.push(`- Files importing \`recoil\`: ${t.filesImportingRecoil} (the files the migration touches); of these, ${t.consumerFiles} consume a feature.`);
  lines.push(`- Jotai already present: ${t.jotaiDefinitions} definitions in ${t.filesImportingJotai} files.`);
  lines.push(`- Ease distribution (5 = easiest): ${Object.entries(t.easeDistribution).sort((a, b) => b[0].localeCompare(a[0])).map(([k, v]) => `${k}: ${v}`).join(', ')}.`);
  lines.push(`- Free (isolated) features: ${t.freeFeatures}; connected components: ${t.components} (largest ${t.largestComponent}).`);
  if (o.baseline) {
    const pct = ((o.baseline.gone.length / Math.max(1, o.baseline.total)) * 100).toFixed(1);
    lines.push(`- Since baseline ${o.baseline.generatedAt}: **${o.baseline.gone.length} of ${o.baseline.total} gone** (${pct}%), ${o.baseline.added.length} added.`);
    if (o.baseline.gone.length) lines.push(`  - gone: ${o.baseline.gone.map((k) => `\`${k}\``).join(', ')}`);
    if (o.baseline.added.length) lines.push(`  - added: ${o.baseline.added.map((k) => `\`${k}\``).join(', ')}`);
  }
  lines.push('', '## Recoil API usage', '', '| API | Category | Uses | Files |', '| --- | --- | --- | --- |');
  for (const [api, u] of Object.entries(o.apiUsage).sort((a, b) => b[1].count - a[1].count)) lines.push(`| \`${api}\` | ${u.category} | ${u.count} | ${u.files} |`);
  if (Object.keys(o.loadableIdioms).length) {
    lines.push('', '### Loadable idioms (in files importing recoil)', '', '| Idiom | Uses | Files |', '| --- | --- | --- |');
    for (const [idiom, u] of Object.entries(o.loadableIdioms).sort((a, b) => b[1].count - a[1].count)) lines.push(`| \`${idiom}\` | ${u.count} | ${u.files} |`);
  }
  if (Object.keys(o.attention).length) {
    lines.push('', '### Mechanical, but check each use against the API map', '', '| API | Uses | Files |', '| --- | --- | --- |');
    for (const [api, u] of Object.entries(o.attention).sort((a, b) => b[1].count - a[1].count)) lines.push(`| \`${api}\` | ${u.count} | ${u.files} |`);
  }
  lines.push('', '## Needs a decision', '');
  if (!Object.keys(o.decisions).length) lines.push('Nothing beyond the mechanical mappings.');
  else {
    lines.push('| Item | Count | Where |', '| --- | --- | --- |');
    for (const [item, d] of Object.entries(o.decisions)) lines.push(`| ${item} | ${d.count} | ${d.files.map((f) => `\`${f}\``).join('<br>') || '—'} |`);
  }
  lines.push('', '## Migration plan', '');
  lines.push(`Direction for connected components: **${o.plan.direction}**. Components of up to ${o.plan.smallComponentMax} features are proposed as one atomic change; larger ones are cut into waves, each listing the bridges (read mirrors or shadows) that must exist while it lands.`, '');
  lines.push(`### Free features (${o.plan.free.length})`, '', code(o.plan.free));
  for (const c of o.plan.components) {
    lines.push('', `### Component ${c.id} — ${c.size} features (${Object.entries(c.kinds).map(([k, v]) => `${v} ${k}`).join(', ')})${c.atomic ? ' — migrate atomically' : ''}`, '');
    if (c.cycles.length) lines.push(`Cycles (move together): ${c.cycles.map((cy) => cy.map(nameOf).join(' ⇄ ')).join('; ')}.`, '');
    if (c.hubCut) {
      const h = c.hubCut;
      lines.push(`**Hub cut** — ${h.hubs.length} hubs bridged for the whole migration, ${h.fragments.length} fragments (largest ${h.largestFragment}) that move atomically in any order; bridges alive: **${h.bridgesAlive}**. Recommended order: **${h.recommendedOrder}**${h.anyFragmentWritesHub ? ' (some fragments write to a hub, so the hubs must already be Jotai)' : ''}.`, '');
      lines.push('Batch size vs bridges: ' + h.options.map((o) => `≤${o.threshold} features/change → ${o.hubs} hubs, ${o.fragments} fragments`).join('; ') + '.', '');
      lines.push('| Hub | Kind | Degree | Consumer files |', '| --- | --- | --- | --- |');
      for (const hub of h.hubs) lines.push(`| \`${nameOf(hub.id)}\` | ${hub.kind} | ${hub.degree} | ${hub.consumerFiles} |`);
      lines.push('', '| Fragment | Size | Features | Reads hubs | Writes hubs |', '| --- | --- | --- | --- | --- |');
      h.fragments.forEach((f, i) => lines.push(`| ${i + 1} | ${f.size} | ${code(f.members)} | ${code(f.readsHubs)} | ${code(f.writesHubs)} |`));
      lines.push('', `**Waves** (${c.direction}) — the alternative cut: ${c.waves.length} waves, max bridges alive ${c.maxAliveBridges} (${c.otherDirection}: ${c.otherDirectionMaxAliveBridges}).`, '');
    }
    if (c.atomic) {
      lines.push(`Move together in one change: ${code(c.members)}. No bridge is needed.`);
      continue;
    }
    lines.push('| Wave | Features | New bridges | Retired bridges | Alive |', '| --- | --- | --- | --- | --- |');
    for (const w of c.waves) lines.push(`| ${w.wave} | ${code(w.features)} | ${code(w.newBridges)} | ${code(w.retiredBridges)} | ${w.aliveBridges} |`);
  }
  lines.push('', '## Features', '', '| Feature | Kind | Ease | Why | Defined in | Depends on | Dependents | Consumers | Comp. | Fragment | Wave |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const f of o.features) {
    const bits = [...f.ease.reasons];
    if (f.flags.isAsync) bits.push('async');
    else if (f.flags.maybeAsync) bits.push('async?');
    if (f.flags.hasSet) bits.push('writable');
    if (f.flags.hasEffects) bits.push(`effects×${f.flags.effectsCount}`);
    if (f.flags.defaultKind) bits.push(`default:${f.flags.defaultKind}`);
    if (f.flags.paramKind) bits.push(`param:${f.flags.paramKind}`);
    if (f.flags.ssrGuard) bits.push('ssr-guard');
    if (f.flags.usesWaitFor.length) bits.push(f.flags.usesWaitFor.join('/'));
    if (f.flags.usesNoWait) bits.push('noWait');
    if (f.flags.refreshCounter) bits.push('refresh-counter');
    if (f.hasTests) bits.push('tests');
    const deps = f.deps.map((d) => `\`${nameOf(d.id)}\`${d.wrapper ? ` (${d.wrapper})` : ''}`).join(', ') || '—';
    lines.push(`| \`${f.name}\` | ${f.kind} | ${f.ease.score} | ${[...new Set(bits)].join(', ') || '—'} | \`${f.file}:${f.line}\` | ${deps} | ${code(f.dependents)} | ${f.consumers.length} | ${f.component} | ${f.fragment ?? '—'} | ${f.wave} |`);
  }
  lines.push('', '## Ease rubric', '');
  for (const r of o.easeRubric) lines.push(`- ${r}`);
  lines.push('');
  return lines.join('\n');
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.srcRoot) {
    console.log('Usage: node inventory.mjs <srcRoot> [--out <dir>] [--baseline <inventory.json>] [--direction sinks-first|sources-first] [--check] [--quiet]');
    process.exit(args.help ? 0 : 2);
  }
  process.exit(run(args));
} catch (error) {
  console.error(`inventory: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
