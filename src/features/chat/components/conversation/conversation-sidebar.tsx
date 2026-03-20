import { Link, useRouterState } from '@tanstack/react-router'
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { MessageSquarePlus, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChatConversationListResponse } from '../../../conversation/models/conversation'
import { cn } from '#/lib/utils'
import { conversationKeys, fetchChatConversationList } from '../../api'

const FALLBACK_CONVERSATION_TITLE = 'New conversation'

function getConversationDisplayTitle(title: string | null | undefined) {
  const normalizedTitle = title?.trim()

  return normalizedTitle && normalizedTitle.length > 0
    ? normalizedTitle
    : FALLBACK_CONVERSATION_TITLE
}

export function ConversationSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<ChatConversationListResponse, Error, InfiniteData<ChatConversationListResponse, string | undefined>, readonly unknown[], string | undefined>({
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      fetchChatConversationList({
        cursor: pageParam,
      }),
    queryKey: conversationKeys.list(),
  })

  useEffect(() => {
    const node = loadMoreRef.current

    if (!node || !hasNextPage) {
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void fetchNextPage()
      }
    })

    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [fetchNextPage, hasNextPage])

  const conversations = data?.pages.flatMap((page) => page.items) ?? []

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-line bg-[rgba(255,255,255,0.66)] backdrop-blur-md transition-[width] duration-200',
        collapsed ? 'w-[92px]' : 'w-[320px]',
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-3">
        <button
          className="inline-flex h-10 w-10 items-center justify-center border border-line bg-surface text-sea-ink transition hover:bg-white/80"
          onClick={() => {
            setCollapsed((current) => !current)
          }}
          type="button"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </button>

        <Link
          className={cn(
            'inline-flex h-10 flex-1 items-center justify-center gap-2 border border-sea-ink bg-sea-ink px-4 text-sm font-medium text-foam transition hover:opacity-90',
            collapsed && 'flex-none px-0',
          )}
          to="/"
        >
          <MessageSquarePlus className="size-4" />
          {!collapsed ? <span>New session</span> : null}
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {!collapsed ? (
          <div className="mb-2 px-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-sea-ink-soft">
            History
          </div>
        ) : null}

        <div className="space-y-1.5">
          {isLoading ? (
            <div className="px-3 py-4 text-sm text-sea-ink-soft">
              Loading conversations...
            </div>
          ) : conversations.length > 0 ? (
            conversations.map((conversation) => {
              const isActive = pathname === `/chat/${conversation.uuid}`
              const displayTitle = getConversationDisplayTitle(conversation.title)

              return (
                <Link
                  activeProps={{
                    className:
                      'border-[rgba(47,106,74,0.26)] bg-[rgba(47,106,74,0.11)]',
                  }}
                  className={cn(
                    'group flex items-center gap-3 border border-transparent px-3 py-3 text-left transition hover:border-line hover:bg-link-bg-hover',
                    isActive &&
                      'border-[rgba(47,106,74,0.26)] bg-[rgba(47,106,74,0.11)]',
                    collapsed && 'justify-center px-0',
                  )}
                  key={conversation.uuid}
                  title={displayTitle}
                  to="/chat/$conversationId"
                  params={{ conversationId: conversation.uuid }}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-line bg-surface text-sea-ink">
                    <span className="text-xs font-semibold">
                      {displayTitle.slice(0, 1).toUpperCase()}
                    </span>
                  </div>

                  {!collapsed ? (
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-sea-ink">
                        {displayTitle}
                      </div>
                      <div className="truncate text-xs text-sea-ink-soft">
                        {new Date(conversation.updated_at).toLocaleString()}
                      </div>
                    </div>
                  ) : null}
                </Link>
              )
            })
          ) : (
            <div className="px-3 py-4 text-sm text-sea-ink-soft">
              {collapsed ? 'No history' : 'No conversations yet.'}
            </div>
          )}
        </div>

        <div className="h-6" ref={loadMoreRef} />

        {isFetchingNextPage && !collapsed ? (
          <div className="px-3 py-2 text-xs text-sea-ink-soft">
            Loading more...
          </div>
        ) : null}
      </div>
    </aside>
  )
}
