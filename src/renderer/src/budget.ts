import { createContext, useContext } from 'react'
import { PLAYABLE_BUDGET, type PlayableBudget } from '@core/checks/playable'

/** The playable budget chosen in Settings: every ✓ / ⚠, filter and ranking judges by it. */
export const BudgetContext = createContext<PlayableBudget>(PLAYABLE_BUDGET)

export const useBudget = () => useContext(BudgetContext)
