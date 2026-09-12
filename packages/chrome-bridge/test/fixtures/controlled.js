import { createEffect, createSignal } from "solid-js"
import { render } from "solid-js/web"

render(() => {
  const [value, setValue] = createSignal("original framework")
  const input = document.createElement("input")
  input.setAttribute("aria-label", "Framework controlled")
  input.addEventListener("input", () => setValue(input.value))
  createEffect(() => {
    input.value = value()
    input.dataset.state = value()
  })
  return input
}, document.querySelector("#controlled"))
document.dispatchEvent(new Event("fixture:controlled-ready"))
