"""Exercise the Flash composition path with Gemini construction forbidden."""
from unittest.mock import Mock

import pytest

from artemis.config.llm import LLMConfig, _expand_default_into_nodes
from artemis.context import ArtemisContext
from artemis.agents.flash import summarizer as summary_module
from artemis.agents.flash.runner import FlashRunner
from artemis.memory.chunking import StepCapsuleLens
from artemis.services import llm as llm_service


@pytest.fixture
def ctx():
    ctx = Mock(spec=ArtemisContext)
    ctx.llm_config = LLMConfig.model_validate(_expand_default_into_nodes({'default': {
        'provider': 'openai', 'model': 'MiniMax-M3',
        'fallback': {'provider': 'openai', 'model': 'MiniMax-M3'},
    }}))
    ctx.data_engine = None
    ctx.step_memory = None
    ctx._active_driver = Mock()
    return ctx


def forbidden_google(*args, **kwargs):
    raise AssertionError('Custom model setup attempted a hidden Gemini client')


def test_flash_startup_ignores_legacy_google_summary_model(ctx, monkeypatch):
    monkeypatch.setattr(summary_module, 'get_google_llm', forbidden_google)
    get_llm = Mock(return_value=Mock())
    monkeypatch.setattr(summary_module, 'get_llm', get_llm)
    runner = FlashRunner(ctx, 'test only; no device operations')
    assert runner.summarizer is not None
    get_llm.assert_called_once_with(ctx, name='summarizer', temperature=0.0)


def test_history_compression_primary_and_fallback_use_configured_provider(ctx, monkeypatch):
    monkeypatch.setattr(llm_service, 'get_google_llm', forbidden_google)
    get_llm = Mock(return_value=Mock())
    monkeypatch.setattr(llm_service, 'get_llm', get_llm)
    lens = StepCapsuleLens('gemini-3.8-flash', ctx=ctx)
    lens._get_llm()
    lens._get_fallback_llm()
    assert lens.model_name == 'MiniMax-M3'
    assert get_llm.call_args_list[0].kwargs == {'name': 'summarizer', 'temperature': 0.0}
    assert get_llm.call_args_list[1].kwargs == {'name': 'summarizer', 'use_fallback': True, 'temperature': 0.0}


def test_invalid_operator_config_surfaces_without_google_fallback(ctx, monkeypatch):
    from artemis.agents.flash import runner as runner_module
    monkeypatch.setattr(summary_module, 'get_llm', Mock(return_value=Mock()))
    monkeypatch.setattr(runner_module, 'get_llm', Mock(side_effect=ValueError('invalid operator')))
    runner = FlashRunner(ctx, 'test only')
    with pytest.raises(ValueError, match='invalid operator'):
        runner._init_llm()


def test_google_summary_keeps_explicit_lightweight_model(ctx, monkeypatch):
    ctx.llm_config.summarizer.provider = 'google'
    google = Mock(return_value=Mock())
    monkeypatch.setattr(summary_module, 'get_google_llm', google)
    monkeypatch.setattr(summary_module, 'get_llm', forbidden_google)
    summary_module.VisualStepSummarizer(ctx, model_name='gemini-test-lite')
    google.assert_called_once_with(model_name='gemini-test-lite', temperature=0.0)


def test_google_history_keeps_explicit_primary_and_fallback(ctx, monkeypatch):
    ctx.llm_config.summarizer.provider = 'google'
    google = Mock(return_value=Mock())
    monkeypatch.setattr(llm_service, 'get_google_llm', google)
    monkeypatch.setattr(llm_service, 'get_llm', forbidden_google)
    lens = StepCapsuleLens('gemini-test', ctx=ctx, fallback_model_name='gemini-fallback')
    lens._get_llm()
    lens._get_fallback_llm()
    assert [c.kwargs['model_name'] for c in google.call_args_list] == [
        'gemini-test', 'gemini-fallback',
    ]
