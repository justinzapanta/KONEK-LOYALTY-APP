import { createContext, useContext } from 'react'

const RequestStatus = createContext('')
export const RequestStatusProvider = RequestStatus.Provider
export const useRequestStatus = () => useContext(RequestStatus)
