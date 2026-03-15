import re

with open('src/routes/api/chat_conversations/$conversationId/completion.tsx', 'r') as f:
    content = f.read()

# Add imports
import_str = "import { publishEvent, subscribeToMessage, getHistory, isCompleted, isAborted, abortMessage } from '#/features/chat/server/events/event-bus'\n"
content = content.replace("import {\n  mutateConversation,", import_str + "import {\n  mutateConversation,")

# Find the start of the ReadableStream
stream_start = content.find('new ReadableStream({')
stream_end = content.find('}),\n          {')

if stream_start == -1 or stream_end == -1:
    print("Could not find stream blocks")
    exit(1)

# The try block inside ReadableStream starts at "try {" inside start(controller)
try_start = content.find('              try {', stream_start)
try_end = content.find('              } catch (error) {', try_start)

if try_start == -1 or try_end == -1:
    print("Could not find try block")
    exit(1)

original_try_block = content[try_start:try_end]
# We need to replace enqueue(...) calls in the try block to publishEvent in a background task
# We can keep `enqueue` as a helper in the background task:
# const enqueueEvent = (chunk: string) => { 
#    const match = chunk.match(/event: ([a-z_]+)/);
#    publishEvent(assistantMessageUuid, chunk, match ? match[1] : undefined);
#    return true;
# }
bg_generator = f"""
        // START BACKGROUND GENERATION
        if (getHistory(assistantMessageUuid).length === 0 && !isAborted(assistantMessageUuid)) {{
          ;(async () => {{
            let closed = false
            let textLength = 0
            let toolUseInputJsonBuffer = ''
            let toolResultDisplayContentJsonBuffer = ''
            const openCitations = new Map<
              string,
              {{
                citation: Omit<ChatCitation, 'end_index' | 'start_index'>
                startIndex: number
              }}
            >()

            const enqueue = (chunk: string) => {{
              if (isAborted(assistantMessageUuid)) return false
              const match = chunk.match(/event: ([a-z_]+)/)
              publishEvent(assistantMessageUuid, chunk, match ? match[1] : undefined)
              return true
            }}

{original_try_block}
            }} catch (error) {{
              console.error("Background generation error", error)
            }}
          }})()
        }}
        // END BACKGROUND GENERATION

        return new Response(
          new ReadableStream({{
            start(controller) {{
              let closed = false
              
              const close = () => {{
                if (closed) return
                closed = true
                try {{
                  controller.close()
                }} catch (e) {{}}
              }}

              const enqueueClient = (chunk: string) => {{
                if (closed || request.signal.aborted) return false
                controller.enqueue(encoder.encode(chunk))
                return true
              }}

              // 1. Replay history
              const history = getHistory(assistantMessageUuid)
              for (const event of history) {{
                if (!enqueueClient(event)) return
              }}

              // 2. Check if already finished
              if (isCompleted(assistantMessageUuid)) {{
                close()
                return
              }}

              // 3. Subscribe to new events
              const unsubscribe = subscribeToMessage(assistantMessageUuid, (eventStr) => {{
                enqueueClient(eventStr)
                if (eventStr.includes('event: message_stop')) {{
                  close()
                  unsubscribe()
                }}
              }})

              // Handle client disconnect
              request.signal.addEventListener('abort', () => {{
                unsubscribe()
                close()
                // Do NOT persistAbort here anymore, since client disconnect shouldn't kill background task
              }})
            }}
          """

new_content = content[:stream_start] + bg_generator + content[stream_end:]

with open('src/routes/api/chat_conversations/$conversationId/completion.tsx', 'w') as f:
    f.write(new_content)

print("Rewritten successfully")
