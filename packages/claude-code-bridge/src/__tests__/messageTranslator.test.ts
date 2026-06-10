/**
 * Message Translator Unit Tests
 */

import { describe, it, expect } from 'vitest'
import { translateCliMessage, createStreamState, type SessionStreamState } from '../sdk/messageTranslator.js'
import type { ServerMessage } from '../types/messages.js'

function translate(msg: any, state?: SessionStreamState): ServerMessage[] {
  return translateCliMessage(msg, state || createStreamState())
}

describe('messageTranslator - stream_event', () => {
  it('translates message_start to status:thinking', () => {
    const result = translate({
      type: 'stream_event',
      event: { type: 'message_start' },
    })
    expect(result).toEqual([{ type: 'status', state: 'thinking' }])
  })

  it('translates content_block_start text to content_start', () => {
    const result = translate({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'text', text: '' },
      },
    })
    expect(result).toEqual([{ type: 'content_start', blockType: 'text' }])
  })

  it('translates content_block_start tool_use to content_start with tool info', () => {
    const result = translate({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', name: 'Bash', id: 'toolu_001' },
      },
    })
    expect(result).toEqual([{
      type: 'content_start',
      blockType: 'tool_use',
      toolName: 'Bash',
      toolUseId: 'toolu_001',
      parentToolUseId: undefined,
    }])
  })

  it('translates content_block_start thinking to status', () => {
    const result = translate({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'thinking' },
      },
    })
    expect(result).toEqual([{ type: 'status', state: 'thinking', verb: 'Thinking' }])
  })

  it('translates text_delta to content_delta', () => {
    const result = translate({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' },
      },
    })
    expect(result).toEqual([{ type: 'content_delta', text: 'Hello' }])
  })

  it('translates input_json_delta to content_delta with toolInput', () => {
    const state = createStreamState()
    // Simulate content_block_start for tool_use first
    translateCliMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', name: 'Bash', id: 'toolu_001' },
      },
    }, state)

    const result = translateCliMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"com' },
      },
    }, state)
    expect(result).toEqual([{ type: 'content_delta', toolInput: '{"com' }])
  })

  it('translates thinking_delta to thinking', () => {
    const result = translate({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'Hmm...' },
      },
    })
    expect(result).toEqual([{ type: 'thinking', text: 'Hmm...' }])
  })

  it('translates content_block_stop for tool_use with valid JSON to tool_use_complete', () => {
    const state = createStreamState()
    // Simulate full tool call lifecycle
    translateCliMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', name: 'Bash', id: 'toolu_001' },
      },
    }, state)
    translateCliMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' },
      },
    }, state)

    const result = translateCliMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_stop',
        index: 0,
      },
    }, state)
    expect(result).toEqual([{
      type: 'tool_use_complete',
      toolName: 'Bash',
      toolUseId: 'toolu_001',
      input: { command: 'ls' },
      parentToolUseId: undefined,
    }])
  })
})

describe('messageTranslator - control_request', () => {
  it('translates can_use_tool to permission_request', () => {
    const result = translate({
      type: 'control_request',
      request_id: 'req_123',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'toolu_001',
        input: { command: 'rm -rf /' },
        description: 'Delete everything',
      },
    })
    expect(result).toEqual([{
      type: 'permission_request',
      requestId: 'req_123',
      toolName: 'Bash',
      toolUseId: 'toolu_001',
      input: { command: 'rm -rf /' },
      description: 'Delete everything',
    }])
  })
})

describe('messageTranslator - result', () => {
  it('translates success result to message_complete', () => {
    const result = translate({
      type: 'result',
      subtype: 'success',
      is_error: false,
      usage: { input_tokens: 100, output_tokens: 50 },
    })
    expect(result).toEqual([{
      type: 'message_complete',
      usage: { input_tokens: 100, output_tokens: 50 },
    }])
  })

  it('translates error result to error + message_complete', () => {
    const result = translate({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['Something went wrong'],
      usage: { input_tokens: 10, output_tokens: 0 },
    })
    expect(result).toEqual([
      { type: 'error', message: 'Something went wrong', code: 'CLI_ERROR' },
      { type: 'message_complete', usage: { input_tokens: 10, output_tokens: 0 } },
    ])
  })
})

describe('messageTranslator - user', () => {
  it('translates user message with tool_result blocks', () => {
    const result = translate({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_001',
          content: 'file.txt\nREADME.md',
          is_error: false,
        }],
      },
    })
    expect(result).toEqual([{
      type: 'tool_result',
      toolUseId: 'toolu_001',
      content: 'file.txt\nREADME.md',
      isError: false,
      parentToolUseId: undefined,
    }])
  })

  it('translates user message with error tool_result', () => {
    const result = translate({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_002',
          content: 'Permission denied',
          is_error: true,
        }],
      },
    })
    expect(result).toEqual([{
      type: 'tool_result',
      toolUseId: 'toolu_002',
      content: 'Permission denied',
      isError: true,
      parentToolUseId: undefined,
    }])
  })
})

describe('messageTranslator - system', () => {
  it('translates init to system_notification with model', () => {
    const result = translate({
      type: 'system',
      subtype: 'init',
      model: 'claude-sonnet-4-20250514',
    })
    expect(result).toEqual([
      {
        type: 'system_notification',
        subtype: 'init',
        message: 'Model: claude-sonnet-4-20250514',
        data: { model: 'claude-sonnet-4-20250514' },
      },
    ])
  })

  it('translates status:compacting', () => {
    const result = translate({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
    })
    expect(result).toEqual([{
      type: 'status',
      state: 'compacting',
      verb: 'Compacting conversation',
    }])
  })

  it('translates api_retry', () => {
    const result = translate({
      type: 'system',
      subtype: 'api_retry',
      attempt: 2,
      max_retries: 5,
      retry_delay_ms: 1000,
      error_status: 529,
      error_type: 'overload',
      error_message: 'Server overloaded',
    })
    expect(result).toEqual([{
      type: 'api_retry',
      attempt: 2,
      maxRetries: 5,
      retryDelayMs: 1000,
      errorStatus: 529,
      errorType: 'overload',
      errorMessage: 'Server overloaded',
    }])
  })
})

describe('messageTranslator - assistant (non-streaming fallback)', () => {
  it('translates assistant error to error message', () => {
    const result = translate({
      type: 'assistant',
      error: 'authentication_failed',
      isApiErrorMessage: true,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'API key invalid' }],
      },
    })
    expect(result).toEqual([{
      type: 'error',
      message: 'API key invalid',
      code: 'authentication_failed',
    }])
  })

  it('translates assistant with tool_use blocks (no prior streaming)', () => {
    const state = createStreamState()
    const result = translateCliMessage({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_003',
          name: 'FileRead',
          input: { file_path: '/tmp/test.txt' },
        }],
      },
    }, state)
    expect(result).toEqual([{
      type: 'tool_use_complete',
      toolName: 'FileRead',
      toolUseId: 'toolu_003',
      input: { file_path: '/tmp/test.txt' },
      parentToolUseId: undefined,
    }])
  })
})
