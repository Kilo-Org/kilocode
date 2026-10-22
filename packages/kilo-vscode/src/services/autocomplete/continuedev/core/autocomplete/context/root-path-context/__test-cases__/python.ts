export const CLASSES = [
  {
    nodeType: "class_definition with multiple superclasses",
    fileName: "python/classes.py",
    language: "Python",
    cursorPosition: { line: 1, character: 8 },
    definitionPositions: [
      { row: 0, column: 21 }, // BaseClass
      { row: 0, column: 29 }, // Person
    ],
  },
  {
    nodeType: "class_definition with multiple superclasses",
    fileName: "python/classes.py",
    language: "Python",
    cursorPosition: { line: 4, character: 8 },
    definitionPositions: [
      { row: 3, column: 31 }, // MetaGroup
    ],
  },
  {
    nodeType: "class_definition with generic superclasses",
    fileName: "python/classes.py",
    language: "Python",
    cursorPosition: { line: 7, character: 8 },
    definitionPositions: [
      { row: 6, column: 21 }, // BaseClass
      { row: 6, column: 29 }, // Address
      { row: 6, column: 41 }, // Gathering
      { row: 6, column: 48 }, // Person
    ],
  },
  {
    nodeType: "class_definition with generic superclasses (built in types)",
    fileName: "python/classes.py",
    language: "Python",
    cursorPosition: { line: 10, character: 8 },
    definitionPositions: [
      { row: 9, column: 24 }, // Address
      { row: 9, column: 33 }, // Person
    ],
  },
]

export const PYTHON_TEST_CASES = [
  // ...FUNCTIONS,
  ...CLASSES,
]
