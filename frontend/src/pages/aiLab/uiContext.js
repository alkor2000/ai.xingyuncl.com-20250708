/**
 * 工作台的界面上下文：学段（L 小学 / P 初中 / M 高中 / H 高阶）与"小学模式"开关。
 * 小学模式：步骤用孩子的说法（"考一考 AI"），正式术语退到小字；结果卡只讲"多少张里对了多少张"，不显示置信区间。
 * 初高中：正式术语 + 置信区间 + 更完整的表格。
 */
import { createContext, useContext } from 'react'

export const AiLabUiContext = createContext({ band: 'P', kid: false })
export const useAiLabUi = () => useContext(AiLabUiContext)
