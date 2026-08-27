"use client"

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react"
import type { ShaderParams } from "@/lib/shader-uniforms"
import {
  disposeShader,
  initShader,
  updateUniforms,
  type ShaderResources,
} from "@/lib/shader-renderer"

interface ShaderCanvasProps {
  params: ShaderParams
  shaderId: string
  /**
   * Frame rate zero: the loop stops and elapsed shader time stops with it, so a
   * redraw while frozen reproduces the same frame rather than jumping forward.
   *
   * One boolean, derived by the page, which is the only place that knows all the
   * reasons. There were three — the gallery is open, the capture mode is Image,
   * and a recording is running (which overrides both) — and reduced motion used
   * to be a fourth, OR'd in here where nothing else could see it. It now picks
   * the initial capture mode instead and never touches the runtime path, so this
   * component is a pure function of one flag. See app/page.tsx.
   */
  isFrozen?: boolean
}

export interface ShaderCanvasRef {
  getCanvas: () => HTMLCanvasElement | null
}

export const ShaderCanvas = forwardRef<ShaderCanvasRef, ShaderCanvasProps>(({ params, shaderId, isFrozen = false }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<WebGLRenderingContext | null>(null)
  const resourcesRef = useRef<ShaderResources | null>(null)
  const animationRef = useRef<number | null>(null)
  const paramsRef = useRef<ShaderParams>(params)
  const shaderIdRef = useRef<string>(shaderId)
  const isFrozenRef = useRef(isFrozen)
  const frozenAtRef = useRef<number | null>(null)
  const totalFrozenTimeRef = useRef(0)
  const renderFnRef = useRef<(() => void) | null>(null)
  const drawFrameRef = useRef<(() => void) | null>(null)
  const isLoopRunningRef = useRef(false)

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
  }))

  useEffect(() => {
    paramsRef.current = params
    if (isFrozenRef.current) {
      drawFrameRef.current?.()
    }
  }, [params])

  useEffect(() => {
    const wasFrozen = isFrozenRef.current
    isFrozenRef.current = isFrozen

    if (isFrozen && !wasFrozen) {
      // Frozen at the live moment, which is the whole of what Image mode does to
      // the canvas: the frame you were looking at is the frame you keep.
      frozenAtRef.current = Date.now()
      drawFrameRef.current?.()
    } else if (!isFrozen && wasFrozen) {
      if (frozenAtRef.current !== null) {
        totalFrozenTimeRef.current += Date.now() - frozenAtRef.current
        frozenAtRef.current = null
      }
      if (!isLoopRunningRef.current && renderFnRef.current) {
        isLoopRunningRef.current = true
        renderFnRef.current()
      }
    }
  }, [isFrozen])

  useEffect(() => {
    if (shaderIdRef.current === shaderId) return

    const gl = glRef.current
    if (!gl) return

    console.log("[v0] Shader changed, reinitializing program")
    const next = initShader(gl, shaderId)
    if (!next) return

    const previous = resourcesRef.current
    resourcesRef.current = next
    shaderIdRef.current = shaderId
    drawFrameRef.current?.()

    if (previous) disposeShader(gl, previous)
  }, [shaderId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext("webgl", {
      antialias: true,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    })
    if (!gl) {
      console.error("[v0] WebGL not supported")
      return
    }

    glRef.current = gl
    resourcesRef.current = initShader(gl, shaderIdRef.current)

    const startTime = Date.now()
    totalFrozenTimeRef.current = 0
    frozenAtRef.current = isFrozenRef.current ? startTime : null

    // Elapsed shader time, held at the moment of freezing so a redraw while
    // frozen reproduces the same frame rather than jumping forward — and so
    // unfreezing resumes with no phase jump, since the frozen interval is
    // excluded rather than caught up on.
    const elapsed = () => {
      const now = frozenAtRef.current ?? Date.now()
      return (now - startTime - totalFrozenTimeRef.current) / 1000
    }

    const drawFrame = () => {
      const resources = resourcesRef.current
      if (!resources) return

      updateUniforms(
        gl,
        resources.program,
        paramsRef.current,
        elapsed(),
        canvas.width,
        canvas.height,
        shaderIdRef.current,
      )

      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    drawFrameRef.current = drawFrame

    const resize = () => {
      const dpr = window.devicePixelRatio || 1

      // `clientWidth`/`clientHeight`, not `getBoundingClientRect()`, and the
      // difference is the whole of this function.
      //
      // The rect is the *transformed* box; these are the layout box. On mobile
      // the viewfinder is scaled down to make room for the controls panel (see
      // controlsSplit), and a buffer sized from the rect follows that scale —
      // which breaks in three ways at once. It reallocates and wipes the buffer
      // against a render loop already drawing every frame. It leaves the buffer
      // stuck at the scaled resolution after the panel closes, because
      // ResizeObserver watches the *content* box and a transform never moves it,
      // so nothing fires to put it back — the canvas comes back upscaled from
      // roughly half resolution. And the scaled rect is fractional, so the
      // device-pixel buffer truncated a hair short of the box it fills and the
      // background showed through the last row as a hairline along the
      // viewfinder's bottom edge.
      //
      // Measuring the layout box makes the buffer constant across the whole
      // transition: the scale is presentation, and the compositor is what
      // resamples it. `Math.ceil`, so the texture always covers its box rather
      // than stopping a fraction of a device pixel short of it on a display
      // whose ratio is not a whole number.
      const width = Math.ceil(canvas.clientWidth * dpr)
      const height = Math.ceil(canvas.clientHeight * dpr)

      // Idempotent, which is what makes "no buffer churn" a guarantee rather
      // than an assumption about who calls this. Assigning to canvas.width wipes
      // the drawing buffer even when the value is unchanged, so the guard has to
      // be here rather than at the call sites.
      if (canvas.width === width && canvas.height === height) return

      canvas.width = width
      canvas.height = height

      gl.viewport(0, 0, canvas.width, canvas.height)

      // Resizing the drawing buffer wipes it, and ResizeObserver callbacks run
      // *after* this frame's requestAnimationFrame — so without an immediate
      // redraw the browser paints one empty (black) frame for every step of a
      // sidebar drag, which reads as flicker.
      drawFrame()
    }

    const resizeObserver = new ResizeObserver(() => {
      resize()
    })
    resizeObserver.observe(canvas)

    resize()

    window.addEventListener("resize", resize)

    const render = () => {
      if (!resourcesRef.current || isFrozenRef.current) {
        isLoopRunningRef.current = false
        return
      }

      drawFrame()

      animationRef.current = requestAnimationFrame(render)
    }

    renderFnRef.current = render
    isLoopRunningRef.current = true
    render()

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", resize)
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
      if (resourcesRef.current) {
        disposeShader(gl, resourcesRef.current)
        resourcesRef.current = null
      }
      glRef.current = null
      renderFnRef.current = null
      drawFrameRef.current = null
      isLoopRunningRef.current = false
    }
  }, [])

  return <canvas ref={canvasRef} className="w-full h-full" />
})

ShaderCanvas.displayName = "ShaderCanvas"
