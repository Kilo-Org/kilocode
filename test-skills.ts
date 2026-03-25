import { Skill } from "./packages/opencode/src/skill/skill";
import { Instance } from "./packages/opencode/src/project/instance";

async function run() {
  console.log("Setting up instance...");
  // Stub instance directory
  Object.defineProperty(Instance, "directory", { get: () => process.cwd() });
  Object.defineProperty(Instance, "worktree", { get: () => process.cwd() });
  
  console.log("Loading all skills...");
  try {
    const skills = await Skill.all();
    console.log("Skills loaded:", skills.map(s => s.name));
  } catch (err) {
    console.error("Error loading skills:", err);
  }
}

run();
