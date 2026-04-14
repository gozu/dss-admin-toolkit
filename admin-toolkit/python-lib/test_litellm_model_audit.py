import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from litellm_model_audit import (
    build_lookup_from_pricing,
    classify_model_reference,
    extract_model_strings_from_text,
    iter_structured_model_values,
)


FIXTURE_PRICING = {
    "gpt-4o": {
        "litellm_provider": "openai",
        "mode": "chat",
        "input_cost_per_token": 0.0000025,
        "output_cost_per_token": 0.00001,
    },
    "gpt-4": {
        "litellm_provider": "openai",
        "mode": "chat",
        "input_cost_per_token": 0.00003,
        "output_cost_per_token": 0.00006,
    },
    "gpt-4o-2024-08-06": {
        "litellm_provider": "openai",
        "mode": "chat",
        "input_cost_per_token": 0.0000025,
        "output_cost_per_token": 0.00001,
    },
    "gpt-3.5-turbo": {
        "litellm_provider": "openai",
        "mode": "chat",
        "input_cost_per_token": 0.0000005,
        "output_cost_per_token": 0.0000015,
    },
    "claude-sonnet-4-20250514": {
        "litellm_provider": "anthropic",
        "mode": "chat",
        "input_cost_per_token": 0.000003,
        "output_cost_per_token": 0.000015,
    },
    "claude-3-5-sonnet-20241022": {
        "litellm_provider": "anthropic",
        "mode": "chat",
        "input_cost_per_token": 0.000003,
        "output_cost_per_token": 0.000015,
    },
    "gemini/gemini-2.5-pro": {
        "litellm_provider": "gemini",
        "mode": "chat",
        "input_cost_per_token": 0.00000125,
        "output_cost_per_token": 0.00001,
    },
    "gemini/gemini-1.5-pro": {
        "litellm_provider": "gemini",
        "mode": "chat",
        "input_cost_per_token": 0.0000035,
        "output_cost_per_token": 0.0000105,
    },
}


class TestLiteLLMModelAudit(unittest.TestCase):
    def setUp(self):
        self.lookup = build_lookup_from_pricing(FIXTURE_PRICING)

    def test_ripoff_model(self):
        result = classify_model_reference("openai:main:gpt-4", self.lookup)
        self.assertTrue(result["matched"])
        self.assertEqual(result["status"], "ripoff")
        self.assertEqual(result["currentModel"], "gpt-4o")

    def test_obsolete_model(self):
        result = classify_model_reference("gpt-3.5-turbo", self.lookup)
        self.assertTrue(result["matched"])
        self.assertEqual(result["status"], "obsolete")

    def test_date_alias_canonicalized(self):
        result = classify_model_reference("gpt-4o-2024-08-06", self.lookup)
        self.assertTrue(result["matched"])
        self.assertEqual(result["status"], "current")
        self.assertEqual(result["canonicalModel"], "gpt-4o")

    def test_provider_prefix(self):
        result = classify_model_reference("gemini/gemini-1.5-pro", self.lookup)
        self.assertTrue(result["matched"])
        self.assertEqual(result["status"], "ripoff")
        self.assertEqual(result["currentModel"], "gemini-2.5-pro")

    def test_unknown_model(self):
        result = classify_model_reference("custom-provider:conn:my-private-model", self.lookup)
        self.assertFalse(result["matched"])
        self.assertEqual(result["status"], "unknown")

    def test_structured_extraction(self):
        payload = {
            "params": {
                "llmId": "openai:main:gpt-4",
                "nested": {"completionModel": "claude-3-5-sonnet-20241022"},
            },
            "notAModel": "hello",
        }
        rows = list(iter_structured_model_values(payload))
        values = [value for _, value in rows]
        self.assertIn("openai:main:gpt-4", values)
        self.assertIn("claude-3-5-sonnet-20241022", values)

    def test_text_extraction(self):
        refs = extract_model_strings_from_text("Try gpt-4o, gpt-4, and gemini-1.5-pro in comments.")
        self.assertIn("gpt-4o", refs)
        self.assertIn("gpt-4", refs)
        self.assertIn("gemini-1.5-pro", refs)


if __name__ == "__main__":
    unittest.main()
