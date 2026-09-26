import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ChatInputArea from '../../../components/chat/new/ChatInputArea'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key, i18n: { language: 'en-US' } }) }))
vi.mock('../../../stores/systemConfigStore', () => ({ default: () => ({ getChatFontConfig: () => ({}) }) }))
const model = { name: 'fixture', display_name: 'Fixture model', credits_per_chat: 20 }
const props = () => ({ inputValue: '', uploadedImages: [], currentModel: model, availableModels: [model],
  imageUploadEnabled: true, documentUploadEnabled: true, hasMessages: true, contextTokens: 200,
  onInputChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), onImageUpload: vi.fn(), onDocumentUpload: vi.fn(),
  onOutputFormatChange: vi.fn(), onModelChange: vi.fn(), onExportChat: vi.fn(), onClearChat: vi.fn(),
  onToggleCanvas: vi.fn(), onToggleThinking: vi.fn() })
describe('chat composer controls', () => {
  beforeEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 }) })
  it('opens all auxiliary tools on demand without sending or changing the model/format', async () => {
    const p=props(); render(<ChatInputArea {...p} inputValue="Unsent draft" />)
    expect(screen.queryByRole('button', {name:'chat.upload.image'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name:'chat.mobile.tools'}))
    for (const name of ['chat.upload.image','chat.upload.document','chat.export','chat.clear','chat.docTemplate.inputButton']) {
      expect(await screen.findByRole('button', {name})).toBeVisible()
    }
    expect(screen.getByRole('textbox')).toHaveValue('Unsent draft')
    expect(p.onSend).not.toHaveBeenCalled(); expect(p.onModelChange).not.toHaveBeenCalled(); expect(p.onOutputFormatChange).not.toHaveBeenCalled()
  })
  it('keeps attachments and draft through opening/closing tools and enforces image/document exclusion', async () => {
    const p=props(); const image={id:1,url:'data:image/png;base64,AA',original_name:'test.png'}
    render(<ChatInputArea {...p} inputValue="Draft" uploadedImages={[image]} />)
    fireEvent.click(screen.getByRole('button',{name:'chat.mobile.tools'}))
    expect(await screen.findByRole('button',{name:'chat.upload.image'})).toBeVisible()
    expect(screen.queryByRole('button',{name:'chat.upload.document'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Close'}))
    expect(screen.getByAltText('test.png')).toBeVisible(); expect(screen.getByRole('textbox')).toHaveValue('Draft')
    expect(p.onImageUpload).not.toHaveBeenCalled()
  })
  it('passes a document once to the existing upload handler without an automatic second upload', async () => {
    const p=props(); render(<ChatInputArea {...p} />)
    fireEvent.click(screen.getByRole('button',{name:'chat.mobile.tools'}))
    const file = new File(['synthetic'], 'draft.txt', {type:'text/plain'})
    const input = document.querySelector('input[accept^=".pdf"]')
    fireEvent.change(input, {target:{files:[file]}})
    await waitFor(()=>expect(p.onDocumentUpload).toHaveBeenCalledTimes(1))
    expect(p.onDocumentUpload.mock.calls[0][0].name).toBe('draft.txt')
  })
  it('disables empty sends and exposes stop during streaming', () => {
    const p=props(); const {rerender}=render(<ChatInputArea {...p} />)
    expect(screen.getByRole('button',{name:'chat.send'})).toBeDisabled()
    rerender(<ChatInputArea {...p} inputValue="Draft" />)
    fireEvent.click(screen.getByRole('button',{name:'chat.send'}));expect(p.onSend).toHaveBeenCalledTimes(1)
    rerender(<ChatInputArea {...p} isStreaming />)
    fireEvent.click(screen.getByRole('button',{name:'chat.stop'}));expect(p.onStop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
  it('retains desktop tool access and token information', () => {
    Object.defineProperty(window,'innerWidth',{configurable:true,value:1280})
    render(<ChatInputArea {...props()} />)
    expect(screen.queryByRole('button',{name:'chat.mobile.tools'})).not.toBeInTheDocument()
    for(const name of ['chat.upload.image','chat.upload.document','chat.export','chat.clear']) expect(screen.getByRole('button',{name})).toBeVisible()
    expect(document.querySelector('.context-token-indicator')).toHaveTextContent('0.2K')
  })
})
