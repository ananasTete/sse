import { describe, expect, it } from 'vitest'

import { ROOT_PARENT_MESSAGE_UUID } from '../models/constants'
import {
  buildConversationDetailSnapshot,
  isConversationDetailEmpty,
} from './conversation-cache'

describe('conversation detail helpers', () => {
  it('treats a seeded snapshot for a new conversation as empty', () => {
    const detail = buildConversationDetailSnapshot({
      summary: {
        created_at: '2026-03-12T00:00:00.000Z',
        current_leaf_message_uuid: null,
        title: 'New conversation',
        updated_at: '2026-03-12T00:00:00.000Z',
        uuid: 'conversation-1',
      },
    })

    expect(isConversationDetailEmpty(detail)).toBe(true)
  })

  it('treats a conversation with persisted messages as non-empty', () => {
    expect(
      isConversationDetailEmpty({
        current_leaf_message_uuid: 'assistant-1',
        mapping: {
          [ROOT_PARENT_MESSAGE_UUID]: {
            child_uuids: ['user-1'],
            message: null,
            parent_uuid: null,
            uuid: ROOT_PARENT_MESSAGE_UUID,
          },
          'assistant-1': {
            child_uuids: [],
            message: null,
            parent_uuid: 'user-1',
            uuid: 'assistant-1',
          },
          'user-1': {
            child_uuids: ['assistant-1'],
            message: null,
            parent_uuid: ROOT_PARENT_MESSAGE_UUID,
            uuid: 'user-1',
          },
        },
      }),
    ).toBe(false)
  })
})
