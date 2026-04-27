"""Stub out DSS-only modules so backend.py can be imported in a plain pytest env."""

import sys
import types


def _install_dataiku_stub():
    if 'dataiku' in sys.modules:
        return
    mod = types.ModuleType('dataiku')

    class _FakeClient:
        def get_general_settings(self):
            class _S:
                def get_raw(self_inner):
                    return {}
            return _S()

    mod.api_client = lambda: _FakeClient()  # type: ignore[attr-defined]
    sys.modules['dataiku'] = mod


def _install_dateutil_stub():
    # Very small stub — only .parser.isoparse is used elsewhere in backend.py,
    # none of our adapter tests touch it, but the import must succeed.
    if 'dateutil' in sys.modules:
        return
    du = types.ModuleType('dateutil')
    parser_mod = types.ModuleType('dateutil.parser')
    from datetime import datetime as _dt

    def _isoparse(s):
        return _dt.fromisoformat(str(s).replace('Z', '+00:00'))

    parser_mod.isoparse = _isoparse  # type: ignore[attr-defined]
    parser_mod.parse = _isoparse  # type: ignore[attr-defined]
    du.parser = parser_mod  # type: ignore[attr-defined]
    sys.modules['dateutil'] = du
    sys.modules['dateutil.parser'] = parser_mod


_install_dataiku_stub()
_install_dateutil_stub()
