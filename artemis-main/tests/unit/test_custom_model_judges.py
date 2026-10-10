"""Custom model setups must not silently require Gemini for auxiliary judges."""
import pytest

from artemis.config.llm import LLMConfig, _expand_default_into_nodes


def config(provider='openai', nodes=None):
    return {'default': {'provider': provider, 'model': 'custom-model',
                        'fallback': {'provider': provider, 'model': 'custom-fallback'}},
            'nodes': nodes or {}}


@pytest.mark.parametrize('provider', ['openai', 'anthropic', 'openrouter'])
def test_custom_default_is_inherited_by_auxiliary_judges(provider):
    cfg = LLMConfig.model_validate(_expand_default_into_nodes(config(provider)))
    for name in ('validator_pixel_safety_net', 'planner_validation'):
        judge = cfg.get_agent(name)
        assert judge.provider == provider
        assert judge.model == 'custom-model'
        assert judge.fallback.model == 'custom-fallback'


def test_google_retains_lightweight_judge_defaults():
    cfg = LLMConfig.model_validate(_expand_default_into_nodes(config('google')))
    for name in ('validator_pixel_safety_net', 'planner_validation'):
        assert cfg.get_agent(name).model == 'gemini-3.5-flash-lite'


@pytest.mark.parametrize('name', ['history_analyzer', 'validator_pixel_safety_net',
                                 'planner_validation', 'output_analyzer'])
def test_explicit_optional_node_override_is_honored(name):
    cfg = LLMConfig.model_validate(_expand_default_into_nodes(
        config(nodes={name: {'model': 'explicit-model', 'fallback': {'model': 'explicit-fallback'}}})))
    assert cfg.get_agent(name).model == 'explicit-model'
    assert cfg.get_agent(name).fallback.model == 'explicit-fallback'


def test_legacy_expanded_configuration_uses_operator_for_missing_judges():
    data = _expand_default_into_nodes(config())
    del data['validator_pixel_safety_net']
    del data['planner_validation']
    cfg = LLMConfig.model_validate(_expand_default_into_nodes(data))
    assert cfg.get_agent('validator_pixel_safety_net') is cfg.operator
    assert cfg.get_agent('planner_validation') is cfg.operator
