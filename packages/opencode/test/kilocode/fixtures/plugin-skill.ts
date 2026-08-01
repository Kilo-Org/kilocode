export default async (input: { directory: string }) => ({
  config: async (cfg: { skills?: { paths?: string[] } }) => {
    cfg.skills = cfg.skills ?? {}
    // Keep the fixture outside the project root so the test exercises the trust
    // boundary used by plugin-provided skill directories, while retaining a
    // unique path for each test run.
    cfg.skills.paths = [...(cfg.skills.paths ?? []), `${input.directory}-plugin-skills`]
  },
})
