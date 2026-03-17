export type ChatTrigger = 'regenerate' | 'submit'

export interface SendMessageInput {
  files?: string[]
  model?: string
  parentMessageUuid?: string
  prompt: string
}

export interface EditUserMessageInput {
  model: string
  prompt: string
}

export interface RegenerateMessageInput {
  model?: string
  prompt?: string
}

export interface SubmitTurnMessageUuids {
  assistant_message_uuid: string
  user_message_uuid: string
}

export interface RegenerateTurnMessageUuids {
  assistant_message_uuid: string
}

export interface SubmitChatCompletionRequest {
  files: string[]
  model: string
  parent_message_uuid: string
  prompt: string
  trigger: 'submit'
  turn_message_uuids: SubmitTurnMessageUuids
}

export interface RegenerateChatCompletionRequest {
  files: string[]
  model: string
  parent_message_uuid: string
  prompt: string
  trigger: 'regenerate'
  turn_message_uuids: RegenerateTurnMessageUuids
}

export type ChatCompletionRequest =
  | RegenerateChatCompletionRequest
  | SubmitChatCompletionRequest
