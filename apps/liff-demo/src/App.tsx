import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Reserve from './pages/Reserve'
import Membership from './pages/Membership'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/reserve" element={<Reserve />} />
        <Route path="/membership" element={<Membership />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
