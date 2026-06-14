/*
Perl Tree-Sitter Query Patterns
Covers:
- subroutine/method declarations (including signatures and attributes)
- package and class declarations
- variable declarations (my/our/local/state)
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
  package: (package_name) @name.definition.package) @definition.package

; Class declarations
(class_statement
  package: (package_name) @name.definition.class) @definition.class

; Role declarations
(role_statement
  package: (package_name) @name.definition.role) @definition.role

; Use statements (modules, pragmas)
(use_statement
  package: (package_name) @name.definition.import) @definition.import

; Require statements
(require_expression
  (bareword) @name.definition.import) @definition.import

; Variable declarations (my/our/local/state)
(phaser_statement
  (declaration_list
    (declaration
      name: [(varname) (array) (hash)]) @name.definition.variable)) @definition.variable

; Statement labels
(statement_label
  label: (_) @name.definition.label) @definition.label

; If/elsif/unless/else conditionals
(conditional_statement) @definition.conditional

; While/until loops
(loop_statement
  body: (_)) @definition.loop

; For/foreach loops
(for_statement) @definition.loop
(foreach_statement) @definition.loop

; Try/catch/finally
(try_block) @definition.try_block
(catch_block) @definition.catch_block
(finally_block) @definition.finally_block

; Return statements
(return_statement) @definition.return

; Function calls
(function_call_expression
  function: (_) @name.definition.function_call) @definition.function_call

; Method calls
(method_call_expression
  method: (_) @name.definition.method_call) @definition.method_call

; Comments
(comment) @definition.comment
`
