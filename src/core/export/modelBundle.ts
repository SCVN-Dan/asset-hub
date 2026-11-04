import type { DependencyReport, MaterialRef } from '../deps/types'
import { guessTextureRole, parseMaterialLook, parseMaterialProps } from '../unity/yaml'

/**
 * A material to rebuild outside Unity (Blender). `target` is the material it
 * goes on in the imported file: a name (the FBX's own, or a .mat GUID in a
 * prefab's GLB), `*` for every material, or `?` for materials the file left
 * untextured (textures an FBX names by file).
 */
export interface BundleMaterial {
  target: string
  /** Name to give it in Blender (the .mat's). */
  name?: string
  /** Repo path of the .mat: colours and numbers come from it. */
  mat?: string
  /** Shader name, to tell unlit shaders. */
  shader?: string
  textures: Array<{ prop: string; path: string }>
}

/** Image formats Blender opens. */
const BLENDER_IMAGE = /\.(png|jpe?g|tga|psd|tiff?|bmp|exr|hdr)$/i

const texturesOf = (m: MaterialRef) =>
  m.textures.flatMap((t) => (t.prop && t.path && BLENDER_IMAGE.test(t.path) ? [{ prop: t.prop, path: t.path }] : []))

const ROLE_PROP = { color: '_MainTex', normal: '_BumpMap', emission: '_EmissionMap' } as const

/**
 * The materials an FBX wears, as the preview dresses it: kind A .mat files (on
 * the FBX material each replaces), a material a prefab puts on it (on all of
 * it), and textures the FBX names itself (`named`, repo paths), placed by file name.
 */
export function modelBundleMaterials(report: DependencyReport | undefined, prefabMaterial: MaterialRef | undefined, named: readonly string[] = []): BundleMaterial[] {
  const out: BundleMaterial[] = []
  if (report?.kind === 'A')
    for (const m of report.materials) if (!m.missing) out.push({ target: m.sourceName ?? m.name, name: m.name, mat: m.path, shader: m.shader?.label, textures: texturesOf(m) })
  if (prefabMaterial) out.push({ target: '*', name: prefabMaterial.name, mat: prefabMaterial.path, shader: prefabMaterial.shader?.label, textures: texturesOf(prefabMaterial) })
  const guessed: BundleMaterial['textures'] = []
  for (const path of named.filter((p) => BLENDER_IMAGE.test(p))) {
    const role = guessTextureRole(baseName(path)) ?? (named.length === 1 ? 'color' : undefined)
    if (role && !guessed.some((t) => t.prop === ROLE_PROP[role])) guessed.push({ prop: ROLE_PROP[role], path })
  }
  if (guessed.length) out.push({ target: '?', textures: guessed })
  return out
}

/** A prefab's materials, by .mat GUID: the names its GLB export gives them. */
export function prefabBundleMaterials(report: DependencyReport): BundleMaterial[] {
  return report.materials.flatMap((m) => (m.guid && !m.missing ? [{ target: m.guid, name: m.name, mat: m.path, shader: m.shader?.label, textures: texturesOf(m) }] : []))
}

/** Every texture file the materials use (repo paths). */
export const bundleTexturePaths = (materials: readonly BundleMaterial[]) => [...new Set(materials.flatMap((m) => m.textures.map((t) => t.path)))]

const baseName = (path: string) => path.split('/').pop() || path

/** A file name in the bundle folder for each repo path: its own name, numbered when two share one. */
export function bundleFileNames(paths: readonly string[]): Map<string, string> {
  const names = new Map<string, string>()
  const taken = new Set<string>()
  for (const path of paths) {
    if (names.has(path)) continue
    const base = baseName(path)
    const dot = base.lastIndexOf('.')
    const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, '']
    let name = base
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${stem}_${i}${ext}`
    taken.add(name.toLowerCase())
    names.set(path, name)
  }
  return names
}

/** One material as Blender's Principled BSDF takes it. Colours are linear; maps are file names in the bundle. */
export interface BlenderMaterial {
  target: string
  name?: string
  color: [number, number, number, number]
  colorMap?: string
  normalMap?: string
  normalScale: number
  /** URP / built-in metallic map: R metallic, A smoothness. */
  metallicMap?: string
  /** HDRP mask map: R metallic, G occlusion, A smoothness. */
  maskMap?: string
  /** Occlusion map (G). */
  occlusionMap?: string
  occlusionStrength: number
  metallic: number
  /** Smoothness, or the scale of the map's when one gives it. */
  smoothness: number
  /** Where smoothness comes from: the metallic or mask map's alpha, the colour map's alpha, or the number. */
  smoothnessFrom: 'map' | 'albedo' | 'value'
  emission?: [number, number, number]
  emissionMap?: string
  surface: 'opaque' | 'cutout' | 'transparent'
  cutoff: number
  unlit: boolean
}

/** Unity keeps material colours in sRGB; Blender's node values are linear. */
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

const COLOR_PROPS = ['_BaseMap', '_BaseColorMap', '_Albedo', '_MainTex', '_Diffuse']

/** A bundle material with what its .mat says (`matText`), its textures named by `fileOf` (undefined: not in the bundle). */
export function blenderMaterial(m: BundleMaterial, matText: string | undefined, fileOf: (path: string) => string | undefined): BlenderMaterial {
  const map = (...props: string[]) => {
    for (const p of props) {
      const t = m.textures.find((x) => x.prop.toLowerCase() === p.toLowerCase())
      const file = t && fileOf(t.path)
      if (file) return file
    }
    return undefined
  }
  const look = matText ? parseMaterialLook(matText) : undefined
  const floats = matText ? parseMaterialProps(matText).floats : {}
  const c = look?.color
  const metallicMap = map('_MetallicGlossMap')
  const maskMap = map('_MaskMap')
  const colorMap = map(...COLOR_PROPS)
  // _SmoothnessTextureChannel 1: smoothness in the colour map's alpha (URP Lit and built-in Standard).
  const fromAlbedo = floats._SmoothnessTextureChannel === 1 && !!colorMap
  const fromMap = !fromAlbedo && !!(metallicMap || maskMap)
  const e = look?.emission
  const emissionMap = look?.emission ? map('_EmissionMap') : undefined
  return {
    target: m.target,
    ...(m.name ? { name: m.name } : {}),
    color: c ? [linear(c.r), linear(c.g), linear(c.b), c.a] : [1, 1, 1, 1],
    ...(colorMap ? { colorMap } : {}),
    ...(map('_BumpMap', '_NormalMap') ? { normalMap: map('_BumpMap', '_NormalMap') } : {}),
    normalScale: floats._BumpScale ?? floats._NormalScale ?? 1,
    ...(metallicMap ? { metallicMap } : {}),
    ...(maskMap ? { maskMap } : {}),
    ...(map('_OcclusionMap') ? { occlusionMap: map('_OcclusionMap') } : {}),
    occlusionStrength: floats._OcclusionStrength ?? 1,
    metallic: look?.metallic ?? 0,
    // Built-in Standard scales a map's smoothness by _GlossMapScale, URP by _Smoothness.
    smoothness: (fromMap || fromAlbedo ? (floats._GlossMapScale ?? look?.smoothness) : look?.smoothness) ?? 0.5,
    smoothnessFrom: fromAlbedo ? 'albedo' : fromMap ? 'map' : 'value',
    // An FBX's own textures (no .mat) are wired as they come: emission when the file says so.
    ...(e ? { emission: [linear(e.r), linear(e.g), linear(e.b)] as [number, number, number] } : !matText && map('_EmissionMap') ? { emission: [1, 1, 1] as [number, number, number] } : {}),
    ...(emissionMap ? { emissionMap } : !matText && map('_EmissionMap') ? { emissionMap: map('_EmissionMap') } : {}),
    surface: look?.surface ?? 'opaque',
    cutoff: look?.cutoff ?? 0.5,
    unlit: /unlit/i.test(m.shader ?? '')
  }
}

/**
 * A Python script for Blender that imports the model next to it (.fbx, or the
 * .glb a prefab is exported as) and rebuilds each material's node tree from
 * `materials`. Paths are relative to the script, so the folder can be moved or
 * unzipped anywhere. `cleanup`: the folder is a temporary copy, deleted once
 * the model and its textures are inside Blender (textures packed).
 */
export function blenderScript(model: string, materials: readonly BlenderMaterial[], { cleanup = false }: { cleanup?: boolean } = {}): string {
  // A JSON string literal is also a valid Python string literal.
  const data = JSON.stringify(JSON.stringify({ model, materials, cleanup }))
  return `# Asset Hub: imports ${model.replace(/[\r\n]/g, ' ')} with its Unity materials.
# In Blender: Scripting > Open > this file > Run Script, or: blender --python open_in_blender.py
import bpy, json, os, re, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.loads(${data})

# An empty scene (no default cube, camera or light).
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

before = set(bpy.data.materials)
path = os.path.join(HERE, DATA["model"])
if path.lower().endswith((".glb", ".gltf")):
    bpy.ops.import_scene.gltf(filepath=path)
else:
    bpy.ops.import_scene.fbx(filepath=path)


def base_name(name):
    return re.sub(r"\\.\\d{3}$", "", name)


def socket(node, *names):
    for n in names:
        s = node.inputs.get(n)
        if s is not None:
            return s
    return None


def build(mat, spec):
    if mat.node_tree is None:
        mat.use_nodes = True
    tree = mat.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None) or nodes.new("ShaderNodeOutputMaterial")
        links.new(bsdf.outputs[0], out.inputs["Surface"])
    x = bsdf.location.x - 700
    y = [bsdf.location.y + 300]

    def place(node, dx=0):
        node.location = (x + dx, y[0])
        y[0] -= 280
        return node

    def image(file, data):
        img = bpy.data.images.load(os.path.join(HERE, file), check_existing=True)
        if data:
            img.colorspace_settings.name = "Non-Color"
        n = place(nodes.new("ShaderNodeTexImage"))
        n.image = img
        return n

    def math(op, a, b, c=None):
        n = nodes.new("ShaderNodeMath")
        n.operation = op
        n.location = (x + 350, y[0] + 140)
        for i, v in enumerate((a, b) if c is None else (a, b, c)):
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                links.new(v, n.inputs[i])
        return n.outputs[0]

    def vmul(a, b):
        n = nodes.new("ShaderNodeVectorMath")
        n.operation = "MULTIPLY"
        n.location = (x + 350, y[0] + 140)
        links.new(a, n.inputs[0])
        if isinstance(b, (tuple, list)):
            n.inputs[1].default_value = b
        else:
            links.new(b, n.inputs[1])
        return n.outputs[0]

    def separate(img):
        n = nodes.new("ShaderNodeSeparateColor") if hasattr(bpy.types, "ShaderNodeSeparateColor") else nodes.new("ShaderNodeSeparateRGB")
        n.location = (x + 300, y[0] + 280)
        links.new(img.outputs["Color"], n.inputs[0])
        return n.outputs

    r, g, b, a = spec["color"]
    color = alpha = color_img = None
    if spec.get("colorMap"):
        img = color_img = image(spec["colorMap"], False)
        color = img.outputs["Color"]
        alpha = img.outputs["Alpha"]
        if (r, g, b) != (1, 1, 1):
            color = vmul(color, (r, g, b))
        if a != 1:
            alpha = math("MULTIPLY", alpha, a)

    # Occlusion darkens the colour (Principled has no input of its own): 1 + strength * (ao - 1).
    ao = None
    if spec.get("occlusionMap"):
        ao = separate(image(spec["occlusionMap"], True))[1]
    mask_img = image(spec["maskMap"], True) if spec.get("maskMap") else None
    mask = separate(mask_img) if mask_img else None
    if mask and ao is None:
        ao = mask[1]
    if ao is not None:
        k = spec["occlusionStrength"]
        ao = math("MULTIPLY_ADD", ao, k, 1 - k)
        color = vmul(color, ao) if color is not None else None
        if color is None:
            n = nodes.new("ShaderNodeCombineXYZ")
            n.location = (x + 350, y[0])
            for i in range(3):
                links.new(math("MULTIPLY", ao, (r, g, b)[i]), n.inputs[i])
            color = n.outputs[0]
    base = socket(bsdf, "Base Color")
    if color is not None:
        links.new(color, base)
    else:
        base.default_value = (r, g, b, 1)

    # Metallic and smoothness: a map's R and A, else the numbers. Roughness = 1 - smoothness.
    metal_img = image(spec["metallicMap"], True) if spec.get("metallicMap") else mask_img
    s = spec["smoothness"]
    if metal_img is not None:
        links.new(separate(metal_img)[0], socket(bsdf, "Metallic"))
    else:
        socket(bsdf, "Metallic").default_value = spec["metallic"]
    gloss = None
    if spec["smoothnessFrom"] == "map" and metal_img is not None:
        gloss = metal_img.outputs["Alpha"]
    elif spec["smoothnessFrom"] == "albedo" and color_img is not None:
        gloss = color_img.outputs["Alpha"]
    if gloss is not None:
        links.new(math("MULTIPLY_ADD", gloss, -s, 1), socket(bsdf, "Roughness"))
    else:
        socket(bsdf, "Roughness").default_value = 1 - s

    if spec.get("normalMap"):
        nmap = nodes.new("ShaderNodeNormalMap")
        img = image(spec["normalMap"], True)
        nmap.location = (x + 350, y[0] + 280)
        nmap.inputs["Strength"].default_value = spec["normalScale"]
        links.new(img.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    emit = socket(bsdf, "Emission Color", "Emission")
    strength = socket(bsdf, "Emission Strength")
    if spec.get("emission"):
        e = spec["emission"]
        if spec.get("emissionMap"):
            links.new(vmul(image(spec["emissionMap"], False).outputs["Color"], tuple(e)), emit)
        else:
            emit.default_value = (e[0], e[1], e[2], 1)
        if strength is not None:
            strength.default_value = 1.0

    # Unlit shaders: the colour as it is, lit by nothing.
    if spec["unlit"]:
        if color is not None:
            links.new(color, emit)
        else:
            emit.default_value = (r, g, b, 1)
        if strength is not None:
            strength.default_value = 1.0
        socket(bsdf, "Roughness").default_value = 1
        spec_in = socket(bsdf, "Specular IOR Level", "Specular")
        if spec_in is not None:
            spec_in.default_value = 0

    if spec["surface"] != "opaque":
        al = alpha if alpha is not None else a
        if spec["surface"] == "cutout" and alpha is not None:
            al = math("GREATER_THAN", alpha, spec["cutoff"])
        if isinstance(al, (int, float)):
            socket(bsdf, "Alpha").default_value = al
        else:
            links.new(al, socket(bsdf, "Alpha"))
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED" if spec["surface"] == "transparent" else "DITHERED"
        elif hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND" if spec["surface"] == "transparent" else "HASHED"

    if spec.get("name"):
        mat.name = spec["name"]


specs = DATA["materials"]
for mat in [m for m in bpy.data.materials if m not in before]:
    textured = mat.node_tree is not None and any(n.type == "TEX_IMAGE" for n in mat.node_tree.nodes)
    name = base_name(mat.name)
    spec = next((s for s in specs if s["target"] == name), None) or next((s for s in specs if s["target"] == "*"), None)
    if spec is None and not textured:
        spec = next((s for s in specs if s["target"] == "?"), None)
    if spec is not None:
        build(mat, spec)

# Textures go inside the .blend when it is saved, so it does not depend on this folder.
try:
    bpy.ops.file.pack_all()
except Exception:
    pass

# A temporary copy (opened by Asset Hub): everything is in Blender now.
if DATA.get("cleanup"):
    shutil.rmtree(HERE, ignore_errors=True)
`
}
