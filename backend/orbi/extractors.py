"""Multi-language AST symbol and import extraction using Tree-sitter."""

from __future__ import annotations

from tree_sitter import Node

from orbi.schema import CodeSymbol, RawImport


def _clean_str(raw: str) -> str:
    s = raw.strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    return s[1:-1] if (s.startswith("<") and s.endswith(">")) else s


def _add_sym(symbols: list[CodeSymbol], kind: str, name: str, line: int) -> None:
    if len(symbols) < 15 and name:
        symbols.append(CodeSymbol(kind=kind, name=name, line=line, summary=f"{kind} {name}"))


def _fld(node: Node, field: str) -> str:
    ch = node.child_by_field_name(field)
    return ch.text.decode("utf-8") if ch else ""


def _extract_py(root: Node, text: str) -> tuple[list[CodeSymbol], list[RawImport]]:
    symbols, imports = [], []

    def visit(node: Node, in_class: bool = False) -> None:
        ntype, line = node.type, node.start_point[0] + 1
        if ntype == "import_statement":
            for ch in node.children:
                if ch.type == "dotted_name":
                    imports.append(RawImport(module=ch.text.decode("utf-8"), line=line, is_relative=False))
                elif ch.type == "aliased_import":
                    n = _fld(ch, "name")
                    if n:
                        imports.append(RawImport(module=n, line=line, is_relative=False))
            return
        if ntype == "import_from_statement":
            s = _fld(node, "module_name")
            if s:
                imports.append(RawImport(module=s, line=line, is_relative=s.startswith(".")))
            return
        if ntype == "class_definition":
            _add_sym(symbols, "class", _fld(node, "name"), line)
            body = node.child_by_field_name("body")
            if body:
                for ch in body.children:
                    visit(ch, in_class=True)
            return
        if ntype == "function_definition":
            _add_sym(symbols, "method" if in_class else "function", _fld(node, "name"), line)
            return
        if not in_class and ntype == "assignment":
            left_node = node.child_by_field_name("left")
            if left_node and left_node.type == "identifier" and left_node.text.decode("utf-8").isupper() and len(left_node.text.decode("utf-8")) > 1:
                _add_sym(symbols, "const", left_node.text.decode("utf-8"), line)
            return
        for ch in node.children:
            visit(ch, in_class=in_class)

    visit(root)
    return symbols, imports


def _extract_js_ts(root: Node, text: str) -> tuple[list[CodeSymbol], list[RawImport]]:
    symbols, imports = [], []

    def visit(node: Node) -> None:
        ntype, line = node.type, node.start_point[0] + 1
        if ntype in ("import_statement", "export_statement"):
            src = _fld(node, "source")
            if src:
                s = _clean_str(src)
                imports.append(RawImport(module=s, line=line, is_relative=s.startswith(".")))
            if ntype == "import_statement":
                return
        if ntype == "call_expression":
            fn, args = node.child_by_field_name("function"), node.child_by_field_name("arguments")
            if fn and fn.text.decode("utf-8") == "require" and args:
                for c in args.children:
                    if c.type == "string":
                        s = _clean_str(c.text.decode("utf-8"))
                        imports.append(RawImport(module=s, line=line, is_relative=s.startswith(".")))
        if ntype == "class_declaration":
            _add_sym(symbols, "class", _fld(node, "name"), line)
        elif ntype == "function_declaration":
            _add_sym(symbols, "function", _fld(node, "name"), line)
        elif ntype == "method_definition":
            _add_sym(symbols, "method", _fld(node, "name"), line)
        elif ntype in ("interface_declaration", "type_alias_declaration"):
            _add_sym(symbols, "const", _fld(node, "name"), line)
        elif ntype == "lexical_declaration":
            for ch in node.children:
                if ch.type == "variable_declarator":
                    _add_sym(symbols, "const", _fld(ch, "name"), line)
        for ch in node.children:
            visit(ch)

    visit(root)
    return symbols, imports


def _extract_c_cpp(root: Node, text: str) -> tuple[list[CodeSymbol], list[RawImport]]:
    symbols, imports = [], []

    def visit(node: Node) -> None:
        ntype, line = node.type, node.start_point[0] + 1
        if ntype == "preproc_include":
            raw = _fld(node, "path").strip()
            if raw:
                imports.append(RawImport(module=_clean_str(raw), line=line, is_relative=raw.startswith('"')))
            return
        if ntype in ("struct_specifier", "class_specifier"):
            _add_sym(symbols, "class", _fld(node, "name"), line)
        elif ntype == "function_definition":
            d = node.child_by_field_name("declarator")
            while d and d.type in ("pointer_declarator", "reference_declarator"):
                d = d.child_by_field_name("declarator") or (d.children[-1] if d.children else None)
            if d and d.type == "function_declarator":
                _add_sym(symbols, "function", _fld(d, "declarator"), line)
        elif ntype == "preproc_def":
            _add_sym(symbols, "const", _fld(node, "name"), line)
        for ch in node.children:
            visit(ch)

    visit(root)
    return symbols, imports


def _extract_java(root: Node, text: str) -> tuple[list[CodeSymbol], list[RawImport]]:
    symbols, imports = [], []

    def visit(node: Node) -> None:
        ntype, line = node.type, node.start_point[0] + 1
        if ntype == "import_declaration":
            for ch in node.children:
                if ch.type in ("scoped_identifier", "identifier"):
                    imports.append(RawImport(module=ch.text.decode("utf-8"), line=line, is_relative=False))
            return
        if ntype in ("class_declaration", "interface_declaration", "enum_declaration", "record_declaration"):
            _add_sym(symbols, "class", _fld(node, "name"), line)
        elif ntype == "method_declaration":
            _add_sym(symbols, "method", _fld(node, "name"), line)
        for ch in node.children:
            visit(ch)

    visit(root)
    return symbols, imports


def _extract_go(root: Node, text: str) -> tuple[list[CodeSymbol], list[RawImport]]:
    symbols, imports = [], []

    def visit(node: Node) -> None:
        ntype, line = node.type, node.start_point[0] + 1
        if ntype == "import_spec":
            p = _fld(node, "path")
            if p:
                s = _clean_str(p)
                imports.append(RawImport(module=s, line=line, is_relative=s.startswith(".")))
        elif ntype in ("function_declaration", "method_declaration"):
            _add_sym(symbols, "method" if ntype == "method_declaration" else "function", _fld(node, "name"), line)
        elif ntype == "type_spec":
            _add_sym(symbols, "class", _fld(node, "name"), line)
        for ch in node.children:
            visit(ch)

    visit(root)
    return symbols, imports


def _extract_rust(root: Node, text: str) -> tuple[list[CodeSymbol], list[RawImport]]:
    symbols, imports = [], []

    def visit(node: Node) -> None:
        ntype, line = node.type, node.start_point[0] + 1
        if ntype == "mod_item":
            n = _fld(node, "name")
            if n and not node.child_by_field_name("body"):
                imports.append(RawImport(module=n, line=line, is_relative=True))
        elif ntype == "use_declaration":
            s = _fld(node, "argument")
            if s:
                imports.append(RawImport(module=s, line=line, is_relative=s.startswith(("crate", "super", "self"))))
        elif ntype in ("struct_item", "enum_item", "trait_item"):
            _add_sym(symbols, "class", _fld(node, "name"), line)
        elif ntype == "function_item":
            _add_sym(symbols, "function", _fld(node, "name"), line)
        elif ntype == "const_item":
            _add_sym(symbols, "const", _fld(node, "name"), line)
        for ch in node.children:
            visit(ch)

    visit(root)
    return symbols, imports


def _extract_csharp(root: Node, text: str) -> tuple[list[CodeSymbol], list[RawImport]]:
    symbols, imports = [], []

    def visit(node: Node) -> None:
        ntype, line = node.type, node.start_point[0] + 1
        if ntype == "using_directive":
            n = _fld(node, "name")
            if n:
                imports.append(RawImport(module=n, line=line, is_relative=False))
            return
        if ntype in ("class_declaration", "interface_declaration", "struct_declaration", "record_declaration"):
            _add_sym(symbols, "class", _fld(node, "name"), line)
        elif ntype == "method_declaration":
            _add_sym(symbols, "method", _fld(node, "name"), line)
        for ch in node.children:
            visit(ch)

    visit(root)
    return symbols, imports


_EXTRACTORS = {
    "python": _extract_py,
    "typescript": _extract_js_ts,
    "tsx": _extract_js_ts,
    "javascript": _extract_js_ts,
    "c": _extract_c_cpp,
    "cpp": _extract_c_cpp,
    "java": _extract_java,
    "go": _extract_go,
    "rust": _extract_rust,
    "c_sharp": _extract_csharp,
    "csharp": _extract_csharp,
}


def extract_ast(grammar_name: str, root: Node, src_bytes: bytes) -> tuple[list[CodeSymbol], list[RawImport]]:
    fn = _EXTRACTORS.get(grammar_name.lower())
    return fn(root, src_bytes.decode("utf-8", errors="replace")) if fn else ([], [])
