import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MessageContent from '../../../components/chat/MessageContent'
vi.mock('../../../components/chat/ArtifactExport', () => ({ default: () => <button>download-answer</button> }))
const base = { id: 'a0300000-0000-4000-8000-000000000001', role: 'assistant', content: 'answer', created_at: '2026-09-18T00:00:00Z' }
describe('download entry eligibility', () => {
  it.each([{ status: 'completed' }, {}])('shows saved and newly completed stream answers: %j', extra => {
    render(<MessageContent message={{ ...base, ...extra }} />)
    expect(screen.getByRole('button', { name: 'download-answer' })).toBeInTheDocument()
  })
  it.each([{ status: 'failed' }, { status: 'streaming' }, { streaming: true }, { temp: true }, { error: true }, { role: 'user' }])('hides unavailable answers: %j', extra => {
    render(<MessageContent message={{ ...base, ...extra }} />)
    expect(screen.queryByRole('button', { name: 'download-answer' })).not.toBeInTheDocument()
  })
})
