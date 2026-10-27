import base from "./vitest.config.ts";
export default { ...base, test: { ...base.test, maxWorkers: 1, fileParallelism: false, coverage: { enabled: false }, projects: base.test.projects.map((project) => ({ ...project, test: { ...project.test, maxWorkers: 1, fileParallelism: false, execArgv: ["--max-old-space-size=384"] } })) } };
