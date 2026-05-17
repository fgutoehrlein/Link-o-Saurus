import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

type GraphNodeKind = 'source' | 'style' | 'asset' | 'config' | 'test' | 'unknown';
type GraphEdgeKind = 'import' | 'dynamic-import' | 'export-from';

type GraphNode = {
  readonly id: string;
  readonly path: string;
  readonly kind: GraphNodeKind;
  readonly area: string;
  readonly lines: number;
  readonly declarations: readonly SymbolDeclaration[];
};

type SymbolDeclaration = {
  readonly name: string;
  readonly kind: string;
  readonly exported: boolean;
  readonly line: number;
};

type GraphEdge = {
  readonly from: string;
  readonly to: string;
  readonly kind: GraphEdgeKind;
  readonly specifier: string;
  readonly symbols: readonly string[];
};

type GraphifyGraph = {
  readonly generatedAt: string;
  readonly root: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly unresolvedImports: readonly UnresolvedImport[];
};

type UnresolvedImport = {
  readonly from: string;
  readonly specifier: string;
  readonly kind: GraphEdgeKind;
};

type ImportRecord = {
  readonly specifier: string;
  readonly kind: GraphEdgeKind;
  readonly symbols: readonly string[];
};

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TRACKED_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  '.css',
  '.json',
  '.md',
  '.png',
  '.svg',
  '.jpg',
  '.jpeg',
  '.webp',
]);
const DEFAULT_SCAN_ROOTS = ['extension', 'scripts', 'tests', 'types'];
const DEFAULT_OUTPUT_DIR = '.graphify';
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.graphify', 'playwright-report', 'test-results']);

const rootDir = process.cwd();

const toPosix = (value: string): string => value.split(path.sep).join('/');

const normalizeRelativePath = (absolutePath: string): string => toPosix(path.relative(rootDir, absolutePath));

const isRelativeSpecifier = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../');

const stripViteQuery = (specifier: string): string => specifier.split('?')[0] ?? specifier;

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
};

const directoryExists = async (directoryPath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

const classifyNode = (relativePath: string): GraphNodeKind => {
  const extension = path.extname(relativePath).toLowerCase();
  if (relativePath.endsWith('.test.ts') || relativePath.endsWith('.test.tsx') || relativePath.startsWith('tests/')) {
    return 'test';
  }
  if (SOURCE_EXTENSIONS.has(extension)) {
    return 'source';
  }
  if (extension === '.css') {
    return 'style';
  }
  if (extension === '.json' || extension === '.md') {
    return 'config';
  }
  if (['.png', '.svg', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    return 'asset';
  }
  return 'unknown';
};

const classifyArea = (relativePath: string): string => {
  const parts = relativePath.split('/');
  if (parts[0] === 'extension' && parts[1] === 'src') {
    return parts[2] ?? 'extension/src';
  }
  return parts[0] ?? 'root';
};

const TEXT_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, '.css', '.json', '.md']);

const countLines = (content: string): number => {
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r?\n/u).length;
};

const hasExportModifier = (node: ts.Node): boolean =>
  Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));

const getDeclarationName = (node: ts.Node): string | undefined => {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return node.name?.text;
  }
  return undefined;
};

const getDeclarationKind = (node: ts.Node): string => {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isModuleDeclaration(node)) return 'namespace';
  if (ts.isVariableStatement(node)) return 'variable';
  return ts.SyntaxKind[node.kind] ?? 'unknown';
};

const getLine = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const extractNamedBindings = (namedBindings: ts.NamedImportBindings | undefined): string[] => {
  if (!namedBindings) {
    return [];
  }
  if (ts.isNamespaceImport(namedBindings)) {
    return [`* as ${namedBindings.name.text}`];
  }
  return namedBindings.elements.map((element) => element.name.text);
};

const extractExportSymbols = (exportClause: ts.NamedExportBindings | undefined): string[] => {
  if (!exportClause) {
    return [];
  }
  if (ts.isNamespaceExport(exportClause)) {
    return [`* as ${exportClause.name.text}`];
  }
  return exportClause.elements.map((element) => element.name.text);
};

const parseSourceFile = (relativePath: string, content: string): { declarations: SymbolDeclaration[]; imports: ImportRecord[] } => {
  const sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations: SymbolDeclaration[] = [];
  const imports: ImportRecord[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const importClause = statement.importClause;
      const symbols = [
        ...(importClause?.name ? [importClause.name.text] : []),
        ...extractNamedBindings(importClause?.namedBindings),
      ];
      imports.push({ specifier: statement.moduleSpecifier.text, kind: 'import', symbols });
      continue;
    }

    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push({
        specifier: statement.moduleSpecifier.text,
        kind: 'export-from',
        symbols: extractExportSymbols(statement.exportClause),
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          declarations.push({
            name: declaration.name.text,
            kind: getDeclarationKind(statement),
            exported: hasExportModifier(statement),
            line: getLine(sourceFile, statement),
          });
        }
      }
      continue;
    }

    const name = getDeclarationName(statement);
    if (name) {
      declarations.push({
        name,
        kind: getDeclarationKind(statement),
        exported: hasExportModifier(statement),
        line: getLine(sourceFile, statement),
      });
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text, kind: 'dynamic-import', symbols: [] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { declarations, imports };
};

const collectFiles = async (scanRoots: readonly string[] = DEFAULT_SCAN_ROOTS): Promise<string[]> => {
  const files: string[] = [];

  const walk = async (absoluteDirectory: string): Promise<void> => {
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') {
        continue;
      }
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(absolutePath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (TRACKED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(normalizeRelativePath(absolutePath));
      }
    }
  };

  for (const scanRoot of scanRoots) {
    const absolutePath = path.resolve(rootDir, scanRoot);
    if (await directoryExists(absolutePath)) {
      await walk(absolutePath);
    } else if (await fileExists(absolutePath)) {
      files.push(normalizeRelativePath(absolutePath));
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
};

const resolveRelativeImport = async (fromRelativePath: string, rawSpecifier: string): Promise<string | undefined> => {
  const specifier = stripViteQuery(rawSpecifier);
  if (!isRelativeSpecifier(specifier)) {
    return undefined;
  }

  const fromDirectory = path.dirname(path.resolve(rootDir, fromRelativePath));
  const basePath = path.resolve(fromDirectory, specifier);
  const candidates = [
    basePath,
    ...Array.from(TRACKED_EXTENSIONS, (extension) => `${basePath}${extension}`),
    ...Array.from(TRACKED_EXTENSIONS, (extension) => path.join(basePath, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return normalizeRelativePath(candidate);
    }
  }
  return undefined;
};

const buildGraph = async (): Promise<GraphifyGraph> => {
  const files = await collectFiles();
  const nodeById = new Map<string, GraphNode>();
  const importRecords = new Map<string, ImportRecord[]>();

  for (const file of files) {
    const absolutePath = path.resolve(rootDir, file);
    const extension = path.extname(file).toLowerCase();
    const isTextFile = TEXT_EXTENSIONS.has(extension);
    const content = isTextFile ? await fs.readFile(absolutePath, 'utf8') : '';
    const parsed = SOURCE_EXTENSIONS.has(extension) ? parseSourceFile(file, content) : { declarations: [], imports: [] };
    nodeById.set(file, {
      id: file,
      path: file,
      kind: classifyNode(file),
      area: classifyArea(file),
      lines: countLines(content),
      declarations: parsed.declarations,
    });
    importRecords.set(file, parsed.imports);
  }

  const edgeByKey = new Map<string, GraphEdge>();
  const unresolvedImports: UnresolvedImport[] = [];

  for (const [from, records] of importRecords) {
    for (const record of records) {
      const target = await resolveRelativeImport(from, record.specifier);
      if (!target) {
        if (isRelativeSpecifier(stripViteQuery(record.specifier))) {
          unresolvedImports.push({ from, specifier: record.specifier, kind: record.kind });
        }
        continue;
      }
      const key = `${from}\0${target}\0${record.kind}\0${record.specifier}`;
      const existing = edgeByKey.get(key);
      edgeByKey.set(key, {
        from,
        to: target,
        kind: record.kind,
        specifier: record.specifier,
        symbols: existing ? Array.from(new Set([...existing.symbols, ...record.symbols])).sort() : record.symbols,
      });
    }
  }

  const edges = Array.from(edgeByKey.values());
  edges.sort((left, right) => `${left.from}:${left.to}:${left.kind}`.localeCompare(`${right.from}:${right.to}:${right.kind}`));
  unresolvedImports.sort((left, right) => `${left.from}:${left.specifier}`.localeCompare(`${right.from}:${right.specifier}`));

  return {
    generatedAt: new Date().toISOString(),
    root: rootDir,
    nodeCount: nodeById.size,
    edgeCount: edges.length,
    nodes: Array.from(nodeById.values()).sort((left, right) => left.id.localeCompare(right.id)),
    edges,
    unresolvedImports,
  };
};

const getAreaSummary = (graph: GraphifyGraph): Map<string, { nodes: number; lines: number; imports: number; dependents: number }> => {
  const summary = new Map<string, { nodes: number; lines: number; imports: number; dependents: number }>();
  const areaByNode = new Map(graph.nodes.map((node) => [node.id, node.area]));
  for (const node of graph.nodes) {
    const current = summary.get(node.area) ?? { nodes: 0, lines: 0, imports: 0, dependents: 0 };
    current.nodes += 1;
    current.lines += node.lines;
    summary.set(node.area, current);
  }
  for (const edge of graph.edges) {
    const fromArea = areaByNode.get(edge.from);
    const toArea = areaByNode.get(edge.to);
    if (fromArea) {
      const current = summary.get(fromArea);
      if (current) current.imports += 1;
    }
    if (toArea) {
      const current = summary.get(toArea);
      if (current) current.dependents += 1;
    }
  }
  return summary;
};

const getTopNodesByDependents = (graph: GraphifyGraph, limit = 15): Array<{ node: GraphNode; dependents: number; imports: number }> => {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const dependents = new Map<string, number>();
  const imports = new Map<string, number>();
  for (const edge of graph.edges) {
    dependents.set(edge.to, (dependents.get(edge.to) ?? 0) + 1);
    imports.set(edge.from, (imports.get(edge.from) ?? 0) + 1);
  }
  return graph.nodes
    .map((node) => ({ node, dependents: dependents.get(node.id) ?? 0, imports: imports.get(node.id) ?? 0 }))
    .filter((entry) => entry.dependents > 0 || entry.imports > 0)
    .sort((left, right) => right.dependents - left.dependents || right.imports - left.imports || left.node.id.localeCompare(right.node.id))
    .slice(0, limit)
    .filter((entry) => nodeById.has(entry.node.id));
};

const renderMarkdown = (graph: GraphifyGraph): string => {
  const areaSummary = Array.from(getAreaSummary(graph).entries()).sort((left, right) => right[1].lines - left[1].lines);
  const topNodes = getTopNodesByDependents(graph);
  const lines = [
    '# Graphify Repository Graph',
    '',
    `Generated: ${graph.generatedAt}`,
    '',
    `- Nodes: ${graph.nodeCount}`,
    `- Edges: ${graph.edgeCount}`,
    `- Unresolved relative imports: ${graph.unresolvedImports.length}`,
    '',
    '## Areas',
    '',
    '| Area | Files | Lines | Imports | Dependents |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...areaSummary.map(([area, stats]) => `| ${area} | ${stats.nodes} | ${stats.lines} | ${stats.imports} | ${stats.dependents} |`),
    '',
    '## Most referenced files',
    '',
    '| File | Dependents | Imports | Lines |',
    '| --- | ---: | ---: | ---: |',
    ...topNodes.map(({ node, dependents, imports }) => `| ${node.path} | ${dependents} | ${imports} | ${node.lines} |`),
    '',
    '## Usage',
    '',
    '- `pnpm graphify` regenerates `.graphify/graph.json` and `.graphify/graph.md`.',
    '- `pnpm graphify -- summary` prints this summary without writing files.',
    '- `pnpm graphify -- explain <file>` prints imports, dependents and top-level declarations for one file.',
    '- `pnpm graphify -- impacted <file>` prints files that directly or transitively depend on a changed file.',
    '',
  ];

  if (graph.unresolvedImports.length > 0) {
    lines.push('## Unresolved relative imports', '', '| From | Specifier | Kind |', '| --- | --- | --- |');
    for (const unresolved of graph.unresolvedImports.slice(0, 50)) {
      lines.push(`| ${unresolved.from} | ${unresolved.specifier} | ${unresolved.kind} |`);
    }
    if (graph.unresolvedImports.length > 50) {
      lines.push(`| … | ${graph.unresolvedImports.length - 50} more | … |`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
};

const writeGraph = async (graph: GraphifyGraph): Promise<void> => {
  const outputDirectory = path.resolve(rootDir, DEFAULT_OUTPUT_DIR);
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, 'graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
  await fs.writeFile(path.join(outputDirectory, 'graph.md'), renderMarkdown(graph));
};

const printSummary = (graph: GraphifyGraph): void => {
  process.stdout.write(renderMarkdown(graph));
};

const normalizeRequestedFile = async (requested: string): Promise<string> => {
  const absolutePath = path.resolve(rootDir, requested);
  if (await fileExists(absolutePath)) {
    return normalizeRelativePath(absolutePath);
  }
  return toPosix(requested.replace(/^\.\//u, ''));
};

const explainFile = async (graph: GraphifyGraph, requestedFile: string): Promise<void> => {
  const file = await normalizeRequestedFile(requestedFile);
  const node = graph.nodes.find((candidate) => candidate.id === file);
  if (!node) {
    throw new Error(`Graphify could not find ${requestedFile} in the indexed graph.`);
  }
  const imports = graph.edges.filter((edge) => edge.from === node.id);
  const dependents = graph.edges.filter((edge) => edge.to === node.id);
  const output = [
    `# ${node.path}`,
    '',
    `- Kind: ${node.kind}`,
    `- Area: ${node.area}`,
    `- Lines: ${node.lines}`,
    `- Imports: ${imports.length}`,
    `- Dependents: ${dependents.length}`,
    '',
    '## Imports',
    ...imports.map((edge) => `- ${edge.to} (${edge.kind}; ${edge.specifier})`),
    imports.length === 0 ? '- None' : undefined,
    '',
    '## Dependents',
    ...dependents.map((edge) => `- ${edge.from} (${edge.kind}; ${edge.specifier})`),
    dependents.length === 0 ? '- None' : undefined,
    '',
    '## Top-level declarations',
    ...node.declarations.map((declaration) => `- ${declaration.exported ? 'export ' : ''}${declaration.kind} ${declaration.name} @ L${declaration.line}`),
    node.declarations.length === 0 ? '- None' : undefined,
    '',
  ].filter((line): line is string => typeof line === 'string');
  process.stdout.write(`${output.join('\n')}\n`);
};

const getImpactedFiles = async (graph: GraphifyGraph, requestedFile: string): Promise<string[]> => {
  const file = await normalizeRequestedFile(requestedFile);
  const dependentsByTarget = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const dependents = dependentsByTarget.get(edge.to) ?? [];
    dependents.push(edge.from);
    dependentsByTarget.set(edge.to, dependents);
  }

  const impacted = new Set<string>();
  const queue = [...(dependentsByTarget.get(file) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || impacted.has(current)) {
      continue;
    }
    impacted.add(current);
    queue.push(...(dependentsByTarget.get(current) ?? []));
  }
  return Array.from(impacted).sort((left, right) => left.localeCompare(right));
};

const printImpacted = async (graph: GraphifyGraph, requestedFile: string): Promise<void> => {
  const impacted = await getImpactedFiles(graph, requestedFile);
  process.stdout.write(`# Impacted by ${requestedFile}\n\n`);
  if (impacted.length === 0) {
    process.stdout.write('- No dependents found.\n');
    return;
  }
  for (const file of impacted) {
    process.stdout.write(`- ${file}\n`);
  }
};

const run = async (): Promise<void> => {
  const [, , rawCommand = 'build', ...args] = process.argv;
  const command = rawCommand === '--' ? args.shift() ?? 'build' : rawCommand;
  const graph = await buildGraph();

  switch (command) {
    case 'build':
      await writeGraph(graph);
      process.stdout.write(`Graphify indexed ${graph.nodeCount} files and ${graph.edgeCount} edges into ${DEFAULT_OUTPUT_DIR}/.\n`);
      break;
    case 'summary':
      printSummary(graph);
      break;
    case 'explain': {
      const file = args[0];
      if (!file) {
        throw new Error('Usage: pnpm graphify -- explain <file>');
      }
      await explainFile(graph, file);
      break;
    }
    case 'impacted': {
      const file = args[0];
      if (!file) {
        throw new Error('Usage: pnpm graphify -- impacted <file>');
      }
      await printImpacted(graph, file);
      break;
    }
    default:
      throw new Error(`Unknown Graphify command: ${command}`);
  }
};

const isCliEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCliEntrypoint) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Graphify failed: ${message}\n`);
    process.exitCode = 1;
  });
}

export { buildGraph, getImpactedFiles, renderMarkdown };
export type { GraphifyGraph, GraphNode, GraphEdge };
