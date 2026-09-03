#!/usr/bin/env swift

import Foundation
import Vision

struct Catalog: Decodable {
    let assets: [Asset]
}

struct Asset: Decodable {
    let assetId: String
    let sha256: String
    let sourcePath: String
    let localPath: String
    let duplicateOf: String?
}

guard CommandLine.arguments.count >= 3 else {
    FileHandle.standardError.write(Data("usage: label-broll-apple-vision <catalog.json> <output.ndjson>\n".utf8))
    exit(2)
}

let catalogURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let catalog = try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: catalogURL))
let assets = catalog.assets.filter { $0.duplicateOf == nil }

try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
FileManager.default.createFile(atPath: outputURL.path, contents: nil)
let output = try FileHandle(forWritingTo: outputURL)
defer { try? output.close() }

for (index, asset) in assets.enumerated() {
    autoreleasepool {
        var record: [String: Any] = [
            "contractVersion": "apple-vision.v1",
            "assetId": asset.assetId,
            "sha256": asset.sha256,
            "sourcePath": asset.sourcePath,
            "faceCount": 0,
            "textRegionCount": 0,
            "classifications": [],
        ]
        do {
            let imageURL = URL(fileURLWithPath: asset.localPath)
            let classification = VNClassifyImageRequest()
            let faces = VNDetectFaceRectanglesRequest()
            let text = VNDetectTextRectanglesRequest()
            let handler = VNImageRequestHandler(url: imageURL, options: [:])
            try handler.perform([classification, faces, text])
            record["classifications"] = (classification.results ?? []).prefix(15).map { observation in
                ["identifier": observation.identifier, "confidence": Double(observation.confidence)]
            }
            record["faceCount"] = faces.results?.count ?? 0
            record["textRegionCount"] = text.results?.count ?? 0
            record["status"] = "ok"
        } catch {
            record["status"] = "error"
            record["error"] = String(describing: error)
        }

        if let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) {
            output.write(data)
            output.write(Data("\n".utf8))
        }
    }
    if (index + 1) % 25 == 0 || index + 1 == assets.count {
        FileHandle.standardError.write(Data("apple-vision \(index + 1)/\(assets.count)\n".utf8))
    }
}
