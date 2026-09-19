import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DiscussionSummary from '../../../components/chat/DiscussionSummary'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }))
describe('discussion summary action', () => {
  it('requires an available answer and stays disabled while another request runs', () => {
    const onSummarize = vi.fn()
    const { rerender } = render(<DiscussionSummary available={false} onSummarize={onSummarize} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<DiscussionSummary available disabled onSummarize={onSummarize} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSummarize).not.toHaveBeenCalled()
  })
  it('prevents duplicate generation and offers retry after failure', async () => {
    let reject
    const onSummarize = vi.fn().mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail })).mockResolvedValue(undefined)
    render(<DiscussionSummary available onSummarize={onSummarize} />)
    const button = screen.getByRole('button')
    fireEvent.click(button); fireEvent.click(button)
    expect(onSummarize).toHaveBeenCalledTimes(1)
    expect(onSummarize).toHaveBeenCalledWith('chat.summary.request')
    reject(new Error('network'))
    await screen.findByText('chat.summary.failed')
    fireEvent.click(button)
    await waitFor(() => expect(onSummarize).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('chat.summary.failed')).not.toBeInTheDocument()
  })
})
