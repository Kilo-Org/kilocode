/*
Perl Tree-Sitter Query Patterns (v1.1.2 grammar)
Covers:
- subroutine/method declarations (including signatures and attributes)
- package and class declarations
- variable declarations (my/our/state/field)
- use/require/import statements
- labels
- control flow (if/elsif/unless/else, while/until/for/foreach)
- try/catch/finally
- return statements
*/
export default `
; Subroutine declarations
(subroutine_declaration_statement
  name: (bareword) @name.definition.function) @definition.function

; Method declarations
(method_declaration_statement
  name: (bareword) @name.definition.method) @definition.method

; Package declarations
(package_statement
  name: (package) @name.definition.package) @definition.package

; Class declarations
(class_statement
  name: (package) @name.definition.class) @definition.class

; Role declarations
(role_statement
  name: (package) @name.definition.role) @definition.role

; Use statements (modules, pragmas)
(use_statement
  module: (package) @name.definition.import) @definition.import

; Require statements
(require_expression
  (bareword) @name.definition.import) @definition.import

; Variable declarations (my/our/state)
(variable_declaration
  [(scalar) (array) (hash)] @name.definition.variable) @definition.variable

; Statement labels
(statement_label
  label: (_) @name.definition.label) @definition.label

; If/elsif/unless/else conditionals
(conditional_statement) @definition.conditional

; While/until loops
(loop_statement
  block: (_)) @definition.loop

; For/foreach loops
(for_statement) @definition.loop

; Try/catch/finally
(try_statement) @definition.try_block
(try_statement
  catch_block: (block)) @definition.catch_block
(try_statement
  finally_block: (block)) @definition.finally_block

; Return statements
(return_expression) @definition.return

; Function calls
(function_call_expression
  function: (_) @name.definition.function_call) @definition.function_call

; Method calls
(method_call_expression
  method: (_) @name.definition.method_call) @definition.method_call

; Comments
(comment) @definition.comment
`
