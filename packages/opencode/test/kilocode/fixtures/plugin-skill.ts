export default async (input: { directory: string }) => ({
  config: async (cfg: { skills?: { paths?: string[] } }) => {
    cfg.skills = cfg.skills ?? {}
    cfg.skills.paths = [...(cfg.skills.paths ?? []), `${input.directory}-plugin-skills`]
  },
})
