interface Feature {
  name: string
  text: string
}

export interface Example {
  id: "crossStack" | "orchestrator" | "ops" | "versions" | "beyondCode"
  tag: string
  title: string
  pitch: string
  features: readonly Feature[]
}

export const examples: readonly Example[] = [
  {
    id: "crossStack",
    tag: "agentManager.splash.examples.crossStack.tag",
    title: "agentManager.splash.examples.crossStack.title",
    pitch: "agentManager.splash.examples.crossStack.pitch",
    features: [
      {
        name: "agentManager.splash.examples.crossStack.feature1.name",
        text: "agentManager.splash.examples.crossStack.feature1.text",
      },
      {
        name: "agentManager.splash.examples.crossStack.feature2.name",
        text: "agentManager.splash.examples.crossStack.feature2.text",
      },
      {
        name: "agentManager.splash.examples.crossStack.feature3.name",
        text: "agentManager.splash.examples.crossStack.feature3.text",
      },
    ],
  },
  {
    id: "orchestrator",
    tag: "agentManager.splash.examples.orchestrator.tag",
    title: "agentManager.splash.examples.orchestrator.title",
    pitch: "agentManager.splash.examples.orchestrator.pitch",
    features: [
      {
        name: "agentManager.splash.examples.orchestrator.feature1.name",
        text: "agentManager.splash.examples.orchestrator.feature1.text",
      },
      {
        name: "agentManager.splash.examples.orchestrator.feature2.name",
        text: "agentManager.splash.examples.orchestrator.feature2.text",
      },
      {
        name: "agentManager.splash.examples.orchestrator.feature3.name",
        text: "agentManager.splash.examples.orchestrator.feature3.text",
      },
    ],
  },
  {
    id: "ops",
    tag: "agentManager.splash.examples.ops.tag",
    title: "agentManager.splash.examples.ops.title",
    pitch: "agentManager.splash.examples.ops.pitch",
    features: [
      {
        name: "agentManager.splash.examples.ops.feature1.name",
        text: "agentManager.splash.examples.ops.feature1.text",
      },
      {
        name: "agentManager.splash.examples.ops.feature2.name",
        text: "agentManager.splash.examples.ops.feature2.text",
      },
      {
        name: "agentManager.splash.examples.ops.feature3.name",
        text: "agentManager.splash.examples.ops.feature3.text",
      },
    ],
  },
  {
    id: "versions",
    tag: "agentManager.splash.examples.versions.tag",
    title: "agentManager.splash.examples.versions.title",
    pitch: "agentManager.splash.examples.versions.pitch",
    features: [
      {
        name: "agentManager.splash.examples.versions.feature1.name",
        text: "agentManager.splash.examples.versions.feature1.text",
      },
      {
        name: "agentManager.splash.examples.versions.feature2.name",
        text: "agentManager.splash.examples.versions.feature2.text",
      },
      {
        name: "agentManager.splash.examples.versions.feature3.name",
        text: "agentManager.splash.examples.versions.feature3.text",
      },
    ],
  },
  {
    id: "beyondCode",
    tag: "agentManager.splash.examples.beyondCode.tag",
    title: "agentManager.splash.examples.beyondCode.title",
    pitch: "agentManager.splash.examples.beyondCode.pitch",
    features: [
      {
        name: "agentManager.splash.examples.beyondCode.feature1.name",
        text: "agentManager.splash.examples.beyondCode.feature1.text",
      },
      {
        name: "agentManager.splash.examples.beyondCode.feature2.name",
        text: "agentManager.splash.examples.beyondCode.feature2.text",
      },
      {
        name: "agentManager.splash.examples.beyondCode.feature3.name",
        text: "agentManager.splash.examples.beyondCode.feature3.text",
      },
    ],
  },
]
