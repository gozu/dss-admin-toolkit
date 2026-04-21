import type { DirEntry, DirTreeData } from '../types';

interface CodeEnvSizesResult {
  codeEnvSizes: Record<string, number>;
}

export class CodeEnvSizesParser {
  private dirTree: DirTreeData | undefined;

  constructor(dirTree: DirTreeData | undefined) {
    this.dirTree = dirTree;
  }

  parse(): CodeEnvSizesResult {
    const codeEnvSizes: Record<string, number> = {};
    if (!this.dirTree || !this.dirTree.root) {
      return { codeEnvSizes };
    }

    const visit = (node: DirEntry, parentNames: string[]) => {
      if (!node.isDirectory) return;

      // Match `code-envs/python/<name>/` or `code-envs/r/<name>/`.
      // parentNames reflects ancestors from root; node.name is the current dir.
      const p = parentNames;
      const len = p.length;
      if (
        len >= 2 &&
        p[len - 2] === 'code-envs' &&
        (p[len - 1] === 'python' || p[len - 1] === 'r')
      ) {
        // This node is an individual code env directory
        codeEnvSizes[node.name] = node.size;
        return; // don't recurse into the env itself
      }

      for (const child of node.children) {
        visit(child, [...parentNames, node.name]);
      }
    };

    visit(this.dirTree.root, []);
    return { codeEnvSizes };
  }
}
