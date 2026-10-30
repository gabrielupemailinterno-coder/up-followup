import React from 'react'
import { createRoot } from 'react-dom/client'
import PopupApp from './PopupApp'
import '../src/brand.css'
import './popup.css'

const root = document.getElementById('root')!
createRoot(root).render(React.createElement(PopupApp))
