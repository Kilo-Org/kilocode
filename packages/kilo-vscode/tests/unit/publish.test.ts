import { expect, test } from "bun:test"
import { Project, SyntaxKind } from "ts-morph"

const project = new Project({ useInMemoryFileSystem: true })
const source = project.createSourceFile(
  "publish.ts",
  await Bun.file(`${import.meta.dir}/../../script/publish.ts`).text(),
)

test.each(["vsce publish --oidc", "${ovsx} publish --trusted-publishing"])(
  "%s retries the same package and skips duplicates",
  (command) => {
    const retry = source
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find(
        (call) => call.getExpression().getText() === "retry" && call.getArguments().at(0)?.getText().includes(command),
      )
    expect(retry).toBeDefined()

    const shell = retry
      ?.getArguments()
      .at(0)
      ?.asKind(SyntaxKind.ArrowFunction)
      ?.getBody()
      .asKind(SyntaxKind.TaggedTemplateExpression)
    expect(shell?.getTag().getText()).toBe("$")
    expect(shell?.getTemplate().getText()).toContain("${flag} --skip-duplicate")
    expect(shell?.getTemplate().getText()).toContain("--packagePath ${vsixPath}")
    expect(shell?.getTemplate().getText()).not.toContain("--pat")
    expect(shell?.getTemplate().getText()).not.toContain("OPENVSX_TOKEN")

    const options = retry?.getArguments().at(1)?.asKind(SyntaxKind.ObjectLiteralExpression)
    const value = (name: string) =>
      options
        ?.getProperty(name)
        ?.asKind(SyntaxKind.PropertyAssignment)
        ?.getInitializer()
        ?.asKind(SyntaxKind.NumericLiteral)
        ?.getLiteralValue()
    expect(value("attempts")).toBe(3)
    expect(value("delay")).toBe(30_000)
  },
)
