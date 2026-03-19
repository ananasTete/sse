import type {
  ChatCompletionContentBlockDeltaEvent,
  ChatCompletionContentBlockStartEvent,
  ChatCompletionContentBlockStopEvent,
  ChatCompletionMessageLimitEvent,
  ChatCompletionMessageStartEvent,
  ChatCompletionMessageSnapshotEvent,
  ChatCompletionMessageStopEvent,
  NewChatMessage,
  ChatContent,
  ChatToolUseContent,
  ChatToolResultContent,
} from '../../models/chat'

function parseSseEvent(eventString: string): { event: string; data: any } | null {
  const lines = eventString.split('\n')
  let data = ''

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      data = line.substring(6).trim()
    }
  }

  if (!data) return null

  try {
    const parsed = JSON.parse(data)
    return { event: parsed.type ?? 'message', data: parsed }
  } catch {
    return null
  }
}

export function reconstructMessageSnapshot(events: string[]): ChatCompletionMessageSnapshotEvent | null {
  let message: NewChatMessage | null = null
  
  // content array matching the stream indices
  const streamBlocks: any[] = []
  
  // Map citation UUID -> Citation object (waiting for end delta)
  const openCitations = new Map<string, any>()

  for (const eventString of events) {
    const parsed = parseSseEvent(eventString)
    if (!parsed) continue
    const { event, data } = parsed

    switch (event) {
      case 'message_start': {
        const payload = data as ChatCompletionMessageStartEvent
        message = {
          content: [],
          created_at: payload.message.created_at,
          files: [],
          metadata: {},
          model: payload.message.model,
          parent_uuid: payload.message.parent_uuid,
          role: payload.message.role,
          stop_reason: null,
          updated_at: payload.message.updated_at,
          uuid: payload.message.uuid,
        }
        break
      }

      case 'content_block_start': {
        const payload = data as ChatCompletionContentBlockStartEvent
        const block = payload.content_block
        
        // Initialize block object with internal buffers
        const newBlock: any = { ...block }
        
        if (block.type === 'tool_use') {
           newBlock._inputBuffer = ''
           // Ensure input is object
           if (!newBlock.input) newBlock.input = {}
        } else if (block.type === 'tool_result') {
           newBlock._contentBuffer = ''
        } else if (block.type === 'text') {
           if (!newBlock.citations) newBlock.citations = []
        }

        streamBlocks[payload.index] = newBlock
        break
      }

      case 'content_block_delta': {
        const payload = data as ChatCompletionContentBlockDeltaEvent
        const block = streamBlocks[payload.index]
        if (!block) continue

        if (block.type === 'text') {
           if (payload.delta.type === 'text_delta') {
             block.text += payload.delta.text
           } else if (payload.delta.type === 'citation_start_delta') {
             // Store start delta
             openCitations.set(payload.delta.citation.uuid, { 
                ...payload.delta.citation,
                start_index: block.text.length // Approximate start index
             })
           } else if (payload.delta.type === 'citation_end_delta') {
             const citation = openCitations.get(payload.delta.citation_uuid)
             if (citation) {
               block.citations.push({
                 ...citation,
                 end_index: block.text.length
               })
               openCitations.delete(payload.delta.citation_uuid)
             }
           }
        } else if (block.type === 'tool_use') {
           if (payload.delta.type === 'input_json_delta') {
             block._inputBuffer += payload.delta.partial_json
             try {
               block.input = JSON.parse(block._inputBuffer)
             } catch {}
           }
        } else if (block.type === 'tool_result') {
           if (payload.delta.type === 'input_json_delta') {
             block._contentBuffer += payload.delta.partial_json
             try {
               block.display_content = JSON.parse(block._contentBuffer)
             } catch {}
           }
        }
        break
      }

      case 'content_block_stop': {
        const payload = data as ChatCompletionContentBlockStopEvent
        const block = streamBlocks[payload.index]
        if (block) {
          block.stop_timestamp = payload.content_block.stop_timestamp
        }
        break
      }

      case 'message_stop': {
        if (message) {
          const payload = data as ChatCompletionMessageStopEvent
          message.stop_reason = payload.message.stop_reason
        }
        break
      }

      case 'message_limit': {
        if (message) {
           const payload = data as ChatCompletionMessageLimitEvent
           message.metadata.message_limit = payload.message_limit
        }
        break
      }
    }
  }

  if (!message) return null

  // Transform streamBlocks into final ChatContent[] structure
  // 1. Filter out tool_results (they will be attached to tool_use)
  // 2. Attach tool_results to their parents
  
  const finalContent: ChatContent[] = []
  const toolResultBlocks: any[] = []

  streamBlocks.forEach((block, index) => {
    if (!block) return
    
    // Clean up internal buffers
    delete block._inputBuffer
    delete block._contentBuffer
    
    if (block.type === 'tool_result') {
      toolResultBlocks.push(block)
    } else {
      finalContent[index] = block
    }
  })

  // Attach results
  for (const result of toolResultBlocks) {
    const parent = finalContent.find(c => c.type === 'tool_use' && c.id === result.tool_use_id) as ChatToolUseContent | undefined
    if (parent) {
      parent.tool_result = result as ChatToolResultContent
    }
  }

  message.content = finalContent

  return {
    type: 'message_snapshot',
    message
  }
}
