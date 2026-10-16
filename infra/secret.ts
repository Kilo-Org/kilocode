sst.Linkable.wrap(random.RandomPassword, (resource) => ({
  properties: {
    value: resource.result,
  },
}))

export const SECRET = {
  HoneycombApiKey: new sst.Secret("HONEYCOMB_API_KEY"),
  HoneycombWebhookSecret: new random.RandomPassword("HoneycombWebhookSecret", { length: 24 }),
}
