import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import './styles.css'
import './command-center.css'
const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={client}><HashRouter><App /></HashRouter></QueryClientProvider></React.StrictMode>
)
