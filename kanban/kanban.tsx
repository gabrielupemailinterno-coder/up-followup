import React from 'react'
import { createRoot } from 'react-dom/client'
import KanbanApp from './KanbanApp'
import { FeedbackProvider } from '../src/feedback'
import '../src/brand.css'
import './kanban.css'

createRoot(document.getElementById('root')!).render(
  React.createElement(FeedbackProvider, null, React.createElement(KanbanApp))
)
