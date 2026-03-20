use arrow_schema::{DataType, Field, Schema};
use std::sync::Arc;

/// Arrow schema for the "chunks" LanceDB table.
pub fn chunks_schema(dims: usize) -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id",          DataType::Utf8,  false),
        Field::new("doc_id",      DataType::Utf8,  false),
        Field::new("source_path", DataType::Utf8,  false),
        Field::new("file_name",   DataType::Utf8,  false),
        Field::new("page_number", DataType::Int32, true),   // nullable: not all formats expose page
        Field::new("chunk_index", DataType::Int32, false),
        Field::new("text",        DataType::Utf8,  false),
        Field::new(
            "embedding",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                dims as i32,
            ),
            false,
        ),
    ]))
}
