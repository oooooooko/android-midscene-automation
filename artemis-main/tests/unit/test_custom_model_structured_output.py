"""Custom providers must use the shared parser before schema validation."""

from unittest.mock import Mock

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableLambda

from artemis.context import ArtemisContext, DeviceContext
from artemis.llm.router import ModelEndpoint, ModelProvider
from artemis.llm.structured import StructuredOutputError
from artemis.services.llm import RobustChatModelWrapper
from third_party.mobile_use.agents.hopper import hopper as hopper_module


def scripted_model(replies, provider=ModelProvider.OPENAI):
    calls = []

    async def respond(messages):
        calls.append(messages)
        return AIMessage(content=replies[len(calls) - 1])

    model = RobustChatModelWrapper(
        RunnableLambda(respond),
        endpoint=ModelEndpoint(provider=provider, model_name='test-custom'),
    )
    return model, calls


@pytest.mark.asyncio
@pytest.mark.parametrize('use_fallback', [False, True])
async def test_hopper_parses_think_and_fenced_final_json(monkeypatch, use_fallback):
    model, calls = scripted_model([
        '<think>{"found": false} is only a hypothesis.</think>\n'
        '```json\n{"found": true, "output": "com.tencent.mm", "reason": "matched"}\n```',
    ])
    monkeypatch.setattr(hopper_module, 'get_llm', Mock(return_value=model))
    ctx = ArtemisContext(device=DeviceContext(device_id='test-no-device'))
    result = await hopper_module.hopper(ctx, 'Find WeChat', 'com.tencent.mm', use_fallback)
    assert result.found is True
    assert result.output == 'com.tencent.mm'
    assert len(calls) == 1
    assert '"required"' in calls[0][-1].content
    assert '"found"' in calls[0][-1].content


@pytest.mark.asyncio
@pytest.mark.parametrize('bad_reply', [
    'WeChat is in the package list.',
    '{"found": true}',
    '<think>{"found": true, "output": "wrong", "reason": "hypothesis"}',
])
async def test_custom_model_gets_one_corrective_reask(bad_reply):
    model, calls = scripted_model([
        bad_reply,
        '{"found": true, "output": "com.tencent.mm", "reason": "matched"}',
    ])
    messages = [HumanMessage(content='Find WeChat')]
    structured = model.with_structured_output(hopper_module.HopperOutput)
    result = await structured.ainvoke(messages)
    assert result.output == 'com.tencent.mm'
    assert len(calls) == 2
    assert 'could not be parsed' in calls[1][-1].content
    assert len(messages) == 1


@pytest.mark.asyncio
async def test_persistent_bad_output_fails_without_unbounded_retries():
    model, calls = scripted_model(['not JSON', '{"found": true}'])
    with pytest.raises(StructuredOutputError, match='schema validation failed'):
        await model.with_structured_output(hopper_module.HopperOutput).ainvoke([])
    assert len(calls) == 2


def test_google_retains_native_structured_output():
    base = Mock()
    model = RobustChatModelWrapper(base, endpoint=ModelEndpoint(
        provider=ModelProvider.GOOGLE, model_name='gemini-test',
    ))
    result = model.with_structured_output(hopper_module.HopperOutput)
    base.with_structured_output.assert_called_once_with(hopper_module.HopperOutput)
    assert isinstance(result, RobustChatModelWrapper)
