import { underRoot } from "./files.ts";
import { changedFiles, listedFiles } from "./git.ts";

/** What narrows the files `files` rules may select. `check` and `plan` both provide it. */
export interface CandidateSource {
  root: string;
  config: { gitignore: boolean };
  /** Check only these files, given relative to the current directory or absolute. */
  files?: string[];
  /** Check only files changed in the working tree against HEAD. */
  changed?: boolean;
  /** Check only files committed since the merge base with this ref. */
  since?: string;
}

/** The root-relative paths `files` names; those outside the root are dropped. */
function namedFiles(root: string, files: string[] | undefined): string[] | undefined {
  return files === undefined ? undefined : files.flatMap((file) => underRoot(root, file) ?? []);
}

function workingTreeFiles(options: CandidateSource): Promise<string[] | undefined> {
  return options.changed === true ? changedFiles(options.root) : Promise.resolve(undefined);
}

function committedFiles(options: CandidateSource): Promise<string[] | undefined> {
  const { root, since } = options;
  return since === undefined ? Promise.resolve(undefined) : changedFiles(root, since);
}

/** What git tracks or does not ignore, when the config respects `.gitignore` and git knows the root. */
async function gitCandidates(options: CandidateSource): Promise<Set<string> | undefined> {
  const listed = options.config.gitignore ? await listedFiles(options.root) : undefined;
  return listed === undefined ? undefined : new Set(listed);
}

/** What narrows a rule's view of the tree. */
export interface Selection {
  /** The files `files` rules may select; undefined when any file may be. */
  candidates?: Set<string>;
  /** What git tracks or does not ignore, which `exists` and `absent` see; undefined outside a work tree or under `gitignore: false`. */
  listed?: Set<string>;
}

/**
 * The files `files` rules may select: the union of every selector given;
 * else what `.gitignore` leaves, in a git work tree; else undefined, so
 * every file may be. The git listing comes along, since `exists` and
 * `absent` respect it whatever the selectors say.
 */
export async function selectionFor(options: CandidateSource): Promise<Selection> {
  const listed = await gitCandidates(options);
  const selected = [
    namedFiles(options.root, options.files),
    await workingTreeFiles(options),
    await committedFiles(options),
  ].filter((paths) => paths !== undefined);
  return { listed, candidates: selected.length === 0 ? listed : new Set(selected.flat()) };
}

/** The `candidates` of `selectionFor`. */
export async function candidatesFor(options: CandidateSource): Promise<Set<string> | undefined> {
  return (await selectionFor(options)).candidates;
}
