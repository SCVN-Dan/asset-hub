// Unity's own frames of an effect, to set beside the app's (window.assetHubFilm, same times).
// Copy into a Unity project's Assets/Editor that has the effect imported (export it with the app), then:
//   Unity -batchmode -projectPath <project> -executeMethod RenderFx.Run -prefab "Assets/…/Effect.prefab" -out <dir> -quit
// (not -nographics: it renders). Frames at 0.05…2.5 s, on the app's background, the camera framed on the particles.

using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

public static class RenderFx
{
    // Renders a prefab's particles at fixed times, like a contact sheet: -prefab <path> -out <dir>
    public static void Run()
    {
        var args = System.Environment.GetCommandLineArgs();
        string Arg(string k) { var i = System.Array.IndexOf(args, k); return i >= 0 ? args[i + 1] : null; }
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(Arg("-prefab"));
        var outDir = Arg("-out");
        Directory.CreateDirectory(outDir);
        var go = (GameObject)Object.Instantiate(prefab);
        var systems = go.GetComponentsInChildren<ParticleSystem>(true);
        var roots = systems.Where(p => p.transform.parent == null || p.transform.parent.GetComponentInParent<ParticleSystem>() == null).ToArray();
        var times = new[] { 0.05f, 0.1f, 0.2f, 0.3f, 0.45f, 0.6f, 0.8f, 1.0f, 1.3f, 1.6f, 2.0f, 2.5f };
        // Frame the camera on everything the effect covers over its run.
        // Particles' own positions (world), the middle 90% on each axis: strays do not push the camera away.
        var xs = new System.Collections.Generic.List<float>(); var ys = new System.Collections.Generic.List<float>(); var zs = new System.Collections.Generic.List<float>();
        var buf = new ParticleSystem.Particle[4000];
        foreach (var t in times)
        {
            foreach (var r in roots) r.Simulate(t, true, true, true);
            foreach (var ps in systems)
            {
                int n = ps.GetParticles(buf);
                for (int k = 0; k < n; k++)
                {
                    var p = ps.main.simulationSpace == ParticleSystemSimulationSpace.World ? buf[k].position : ps.transform.TransformPoint(buf[k].position);
                    xs.Add(p.x); ys.Add(p.y); zs.Add(p.z);
                }
            }
        }
        float Q(System.Collections.Generic.List<float> v, float q) { v.Sort(); return v.Count == 0 ? 0 : v[Mathf.Clamp((int)(q * v.Count), 0, v.Count - 1)]; }
        var lo = new Vector3(Q(xs, 0.05f), Q(ys, 0.05f), Q(zs, 0.05f));
        var hi = new Vector3(Q(xs, 0.95f), Q(ys, 0.95f), Q(zs, 0.95f));
        var bounds = new Bounds((lo + hi) / 2, Vector3.Max(hi - lo, Vector3.one * 0.8f));
        var cam = new GameObject("cam").AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color32(14, 19, 27, 255);
        cam.fieldOfView = 40;
        // Soft particles read the scene's depth: a game camera has it, so this one does too.
        cam.depthTextureMode = DepthTextureMode.Depth;
        var dir = new Vector3(0, 0.35f, -1).normalized;
        var dist = bounds.extents.magnitude / Mathf.Sin(20 * Mathf.Deg2Rad) * 1.05f;
        cam.transform.position = bounds.center + dir * dist;
        cam.transform.LookAt(bounds.center);
        cam.nearClipPlane = 0.01f; cam.farClipPlane = dist * 4;
        var rt = new RenderTexture(480, 360, 24, RenderTextureFormat.ARGB32);
        cam.targetTexture = rt;
        var tex = new Texture2D(480, 360, TextureFormat.RGB24, false);
        for (int i = 0; i < times.Length; i++)
        {
            foreach (var r in roots) r.Simulate(times[i], true, true, true);
            cam.Render();
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, 480, 360), 0, 0);
            tex.Apply();
            File.WriteAllBytes(Path.Combine(outDir, i.ToString("00") + "_" + times[i].ToString("0.00") + ".png"), tex.EncodeToPNG());
        }
        Debug.Log("RENDERFX|done|" + roots.Length + " roots|bounds " + bounds);
    }
}
