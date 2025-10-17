import Parser from "web-tree-sitter";

import { getParserForFile } from "../../util/treeSitter";

export type AstPath = Parser.SyntaxNode[];

export async function getAst(
  filepath: string,
  fileContents: string,
): Promise<Parser.Tree | undefined> {
  const parser = await getParserForFile(filepath);

  if (!parser) {
    return undefined;
  }

  try {
    const ast = parser.parse(fileContents);
    return ast;
  } catch {
    return undefined;
  }
}

export async function getTreePathAtCursor(
  ast: Parser.Tree,
  cursorIndex: number,
): Promise<AstPath> {
  const path = [ast.rootNode];
  while (path[path.length - 1].childCount > 0) {
    let foundChild = false;
    for (const child of path[path.length - 1].children) {
      if (child.startIndex <= cursorIndex && child.endIndex >= cursorIndex) {
        path.push(child);
        foundChild = true;
        break;
      }
    }

    if (!foundChild) {
      break;
    }
  }

  return path;
}
